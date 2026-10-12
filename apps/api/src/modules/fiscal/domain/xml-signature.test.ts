import { describe, expect, it } from 'vitest';
import { assinarNfe, nfeXml } from '../../../../test/fiscal-fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { loadTrustStore } from '../infra/trust-store';
import { certificateProblems, verifyNfeSignature } from './xml-signature';

const AC_TESTE = path.resolve(__dirname, '../../../../test/fixtures/certificados/ac-teste.pem');
/** ICP-Brasil + a AC fictícia dos testes. */
const confianca = loadTrustStore([AC_TESTE]);
const soIcpBrasil = loadTrustStore();

describe('assinatura digital do XML (XMLDSig)', () => {
  it('XML sem assinatura: MISSING', () => {
    expect(verifyNfeSignature(nfeXml().xml, confianca)).toEqual({ status: 'MISSING' });
  });

  it('XML assinado e intacto: VALID, com o certificado conferido contra o emitente', () => {
    const r = verifyNfeSignature(assinarNfe(nfeXml().xml), confianca);
    expect(r.status).toBe('VALID');
    if (r.status !== 'VALID') return;
    expect(r.certificate).toMatchObject({ cnpj: '11222333000181', matchesIssuer: true, selfSigned: false, validAtIssue: true, icpBrasil: true });
    expect(r.certificate.chain).toEqual(['SUPERMERCADO EXEMPLO LTDA:11222333000181', 'AC FICTICIA DE TESTE - NAO E ICP-BRASIL']);
    expect(certificateProblems(r.certificate)).toEqual([]);
  });

  it('valor editado depois de assinado: CONTENT_ALTERED', () => {
    const assinado = assinarNfe(nfeXml({ items: [{ description: 'ARROZ', totalCents: 1_000 }] }).xml);
    const editado = assinado.replace('<vNF>10.00</vNF>', '<vNF>90.00</vNF>');
    expect(editado).not.toBe(assinado);
    expect(verifyNfeSignature(editado, confianca)).toMatchObject({ status: 'INVALID', reason: 'CONTENT_ALTERED' });
  });

  it('item trocado depois de assinado: CONTENT_ALTERED', () => {
    const assinado = assinarNfe(nfeXml({ items: [{ description: 'ARROZ', totalCents: 1_000 }] }).xml);
    expect(verifyNfeSignature(assinado.replace('<xProd>ARROZ</xProd>', '<xProd>CERVEJA</xProd>'), confianca)).toMatchObject({ status: 'INVALID' });
  });

  it('certificado autoassinado e de outro CNPJ aparecem como problemas do certificado', () => {
    const r = verifyNfeSignature(assinarNfe(nfeXml().xml, 'autoassinado'), confianca);
    expect(r.status).toBe('VALID');
    if (r.status !== 'VALID') return;
    expect(certificateProblems(r.certificate)).toContain('Certificado autoassinado');
    expect(certificateProblems({ ...r.certificate, selfSigned: false, icpBrasil: true, cnpj: '99888777000100', matchesIssuer: false })).toEqual([
      'CNPJ do certificado diferente do emitente',
    ]);
  });

  it('segunda infNFe com o mesmo Id (embrulho de assinatura) é recusada', () => {
    const assinado = assinarNfe(nfeXml().xml);
    const id = /Id="(NFe\d{44})"/.exec(assinado)![1]!;
    const embrulhado = assinado.replace('</nfeProc>', `<extra><x Id="${id}"/></extra></nfeProc>`);
    expect(verifyNfeSignature(embrulhado, confianca)).toMatchObject({ status: 'INVALID', reason: 'DUPLICATE_ID' });
  });

  it('assinatura sem certificado: NO_CERTIFICATE', () => {
    const assinado = assinarNfe(nfeXml().xml).replace(/<KeyInfo>[\s\S]*<\/KeyInfo>/, '');
    expect(verifyNfeSignature(assinado, confianca)).toMatchObject({ status: 'INVALID', reason: 'NO_CERTIFICATE' });
  });
});

describe('cadeia ICP-Brasil', () => {
  it('o pacote oficial do ITI carrega as raízes e as ACs encadeiam até elas', () => {
    expect(soIcpBrasil.rootCount).toBeGreaterThanOrEqual(5);
    expect(soIcpBrasil.size).toBeGreaterThan(100);
    const pem = readFileSync(path.resolve(__dirname, '../../../../assets/icp-brasil/acs-icp-brasil.pem'), 'utf8');
    const blocos = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!;
    const intermediaria = blocos.map((b) => new X509Certificate(b)).find((c) => c.subject !== c.issuer)!;
    const r = soIcpBrasil.chainFor(intermediaria, null);
    expect(r.trusted).toBe(true);
    expect(r.chain.at(-1)).toMatch(/Autoridade Certificadora Raiz Brasileira/);
  });

  it('certificado de AC fora da ICP-Brasil: assinatura íntegra, mas o certificado não confere', () => {
    const r = verifyNfeSignature(assinarNfe(nfeXml().xml), soIcpBrasil);
    expect(r.status).toBe('VALID');
    if (r.status !== 'VALID') return;
    expect(r.certificate.icpBrasil).toBe(false);
    expect(certificateProblems(r.certificate)).toEqual(['Certificado não emitido por AC da ICP-Brasil']);
  });

  it('AC vencida na data de emissão quebra a cadeia', () => {
    const folha = new X509Certificate(readFileSync(path.resolve(__dirname, '../../../../test/fixtures/certificados/emitente.pem')));
    const r = confianca.chainFor(folha, new Date('2050-01-01T00:00:00Z'));
    expect(r).toMatchObject({ trusted: false, problem: expect.stringContaining('fora da validade') });
  });
});
