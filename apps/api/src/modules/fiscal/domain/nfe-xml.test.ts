import { describe, expect, it } from 'vitest';
import { accessKey, nfeXml } from '../../../../test/fiscal-fixtures';
import { parseNfeXml } from './nfe-xml';

describe('leitura do XML de NF-e/NFC-e', () => {
  it('extrai chave, emitente, total, itens e protocolo sem float', () => {
    const { xml, key } = nfeXml({ items: [{ description: 'ARROZ', totalCents: 1_999 }, { description: 'OLEO', totalCents: 801 }] });
    const r = parseNfeXml(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      accessKey: key,
      model: 'NFCE_65',
      uf: 'DF',
      environment: 1,
      issuer: { document: '11222333000181', name: 'SUPERMERCADO EXEMPLO LTDA' },
      totalCents: 2_800,
      protocol: { status: 100, number: '353260000000001' },
      warnings: [],
    });
    expect(r.value.items.map((i) => [i.description, i.totalCents])).toEqual([
      ['ARROZ', 1_999],
      ['OLEO', 801],
    ]);
  });

  it('não guarda o CPF do comprador', () => {
    const r = parseNfeXml(nfeXml().xml);
    expect(JSON.stringify(r)).not.toContain('52998224725');
  });

  it('aponta campos que não batem com a chave (XML editado)', () => {
    const r = parseNfeXml(nfeXml({ overrideNumber: 999, emitCnpj: '11444777000161', dhEmi: '2025-01-01T10:00:00-03:00' }).xml);
    expect(r.ok && r.value.warnings).toEqual([
      'Número da nota diferente da chave de acesso',
      'Emitente da nota diferente da chave de acesso',
      'Data de emissão diferente do ano/mês da chave de acesso',
    ]);
  });

  it('marca protocolo ausente, de outra chave e ambiente de homologação', () => {
    const semProt = parseNfeXml(nfeXml({ cStat: null }).xml);
    expect(semProt.ok && semProt.value.protocol).toBeNull();
    const homolog = parseNfeXml(nfeXml({ tpAmb: 2 }).xml);
    expect(homolog.ok && homolog.value.environment).toBe(2);
    const { xml } = nfeXml();
    const outra = xml.replace(/<chNFe>\d+<\/chNFe>/, `<chNFe>${accessKey()}</chNFe>`);
    const r = parseNfeXml(outra);
    expect(r.ok && r.value.warnings).toContain('Protocolo de autorização é de outra chave de acesso');
  });

  it('recusa DTD/entidades (XXE), XML quebrado, não-NF-e e chave inválida', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>&e;</nfeProc>`;
    expect(parseNfeXml(xxe)).toEqual({ ok: false, error: 'XML_PROIBIDO' });
    expect(parseNfeXml('<?xml version="1.0"?><a><b></a>')).toEqual({ ok: false, error: 'XML_INVALIDO' });
    expect(parseNfeXml('<?xml version="1.0"?><html><body/></html>')).toEqual({ ok: false, error: 'NAO_E_NFE' });
    const { xml, key } = nfeXml();
    const dvErrado = key.slice(0, 43) + String((Number(key[43]) + 1) % 10);
    expect(parseNfeXml(xml.replace(`NFe${key}`, `NFe${dvErrado}`))).toEqual({ ok: false, error: 'CHAVE_INVALIDA' });
  });
});
