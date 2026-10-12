import { describe, expect, it } from 'vitest';
import { assinarNfe, nfeXml } from '../../../../test/fiscal-fixtures';
import { certificateProblems, verifyNfeSignature } from './xml-signature';

describe('assinatura digital do XML (XMLDSig)', () => {
  it('XML sem assinatura: MISSING', () => {
    expect(verifyNfeSignature(nfeXml().xml)).toEqual({ status: 'MISSING' });
  });

  it('XML assinado e intacto: VALID, com o certificado conferido contra o emitente', () => {
    const r = verifyNfeSignature(assinarNfe(nfeXml().xml));
    expect(r.status).toBe('VALID');
    if (r.status !== 'VALID') return;
    expect(r.certificate).toMatchObject({ cnpj: '11222333000181', matchesIssuer: true, selfSigned: false, validAtIssue: true });
    expect(certificateProblems(r.certificate)).toEqual([]);
  });

  it('valor editado depois de assinado: CONTENT_ALTERED', () => {
    const assinado = assinarNfe(nfeXml({ items: [{ description: 'ARROZ', totalCents: 1_000 }] }).xml);
    const editado = assinado.replace('<vNF>10.00</vNF>', '<vNF>90.00</vNF>');
    expect(editado).not.toBe(assinado);
    expect(verifyNfeSignature(editado)).toMatchObject({ status: 'INVALID', reason: 'CONTENT_ALTERED' });
  });

  it('item trocado depois de assinado: CONTENT_ALTERED', () => {
    const assinado = assinarNfe(nfeXml({ items: [{ description: 'ARROZ', totalCents: 1_000 }] }).xml);
    expect(verifyNfeSignature(assinado.replace('<xProd>ARROZ</xProd>', '<xProd>CERVEJA</xProd>'))).toMatchObject({ status: 'INVALID' });
  });

  it('certificado autoassinado e de outro CNPJ aparecem como problemas do certificado', () => {
    const r = verifyNfeSignature(assinarNfe(nfeXml().xml, 'autoassinado'));
    expect(r.status).toBe('VALID');
    if (r.status !== 'VALID') return;
    expect(certificateProblems(r.certificate)).toContain('Certificado autoassinado');
    expect(certificateProblems({ ...r.certificate, selfSigned: false, cnpj: '99888777000100', matchesIssuer: false })).toEqual([
      'CNPJ do certificado diferente do emitente',
    ]);
  });

  it('segunda infNFe com o mesmo Id (embrulho de assinatura) é recusada', () => {
    const assinado = assinarNfe(nfeXml().xml);
    const id = /Id="(NFe\d{44})"/.exec(assinado)![1]!;
    const embrulhado = assinado.replace('</nfeProc>', `<extra><x Id="${id}"/></extra></nfeProc>`);
    expect(verifyNfeSignature(embrulhado)).toMatchObject({ status: 'INVALID', reason: 'DUPLICATE_ID' });
  });

  it('assinatura sem certificado: NO_CERTIFICATE', () => {
    const assinado = assinarNfe(nfeXml().xml).replace(/<KeyInfo>[\s\S]*<\/KeyInfo>/, '');
    expect(verifyNfeSignature(assinado)).toMatchObject({ status: 'INVALID', reason: 'NO_CERTIFICATE' });
  });
});
