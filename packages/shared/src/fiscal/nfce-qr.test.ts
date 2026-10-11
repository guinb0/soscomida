import { describe, expect, it } from 'vitest';
import { decimalToCents } from '../money';
import { formatCnpj, publicSupplierDocument } from '../documents';
import { accessKeyCheckDigit } from './access-key';
import { parseNfceQrCode } from './nfce-qr';

const chave = (modelo = '65') => {
  const base = `5326031122233300018${'1'}${modelo}001000012345112345678`;
  return base + String(accessKeyCheckDigit(base));
};

describe('QR Code de NFC-e', () => {
  it('lê o formato online da versão 2 (só chave e ambiente)', () => {
    const r = parseNfceQrCode(`https://www.fazenda.df.gov.br/nfce/qrcode?p=${chave()}|2|1|1|ABCDEF0123456789`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ version: '2', environment: 1, totalCents: null, consultationUrl: 'https://www.fazenda.df.gov.br/nfce/qrcode' });
    expect(r.value.accessKey.uf).toBe('DF');
  });

  it('lê o valor total no formato offline da versão 2', () => {
    const r = parseNfceQrCode(`https://x.sefaz.gov.br/qr?p=${chave()}|2|1|11|123.45|6162633d|1|HASH`);
    expect(r.ok && r.value.totalCents).toBe(12_345);
  });

  it('aceita parâmetros nomeados da versão 1', () => {
    const r = parseNfceQrCode(`http://nfce.sefaz.x.gov.br/consulta?chNFe=${chave()}&nVersao=100&tpAmb=2&vNF=10.50&cHashQRCode=abc`);
    expect(r.ok && r.value).toMatchObject({ environment: 2, totalCents: 1_050 });
  });

  it('aceita só o conteúdo do parâmetro p', () => {
    expect(parseNfceQrCode(`${chave()}|2|1|1|HASH`).ok).toBe(true);
  });

  it('recusa chave com DV errado, NF-e modelo 55 e textos sem chave', () => {
    const errada = chave().slice(0, 43) + String((Number(chave()[43]) + 1) % 10);
    expect(parseNfceQrCode(`https://x/qr?p=${errada}|2|1`)).toEqual({ ok: false, error: 'CHAVE_INVALIDA' });
    expect(parseNfceQrCode(`https://x/qr?p=${chave('55')}|2|1`)).toEqual({ ok: false, error: 'NAO_E_NFCE' });
    expect(parseNfceQrCode('https://exemplo.com/promocao')).toEqual({ ok: false, error: 'SEM_CHAVE' });
  });
});

describe('formatação de documentos e decimais fiscais', () => {
  it('formata CNPJ e mascara CPF para exibição pública', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(publicSupplierDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(publicSupplierDocument('529.982.247-25')).toBe('***.982.247-**');
    expect(publicSupplierDocument(null)).toBeNull();
  });

  it('converte decimal fiscal sem float', () => {
    expect(decimalToCents('0.1')).toBe(10);
    expect(decimalToCents('1234.56')).toBe(123_456);
    expect(decimalToCents('7')).toBe(700);
    expect(() => decimalToCents('1,00')).toThrow();
    expect(() => decimalToCents('1.234')).toThrow();
  });
});
