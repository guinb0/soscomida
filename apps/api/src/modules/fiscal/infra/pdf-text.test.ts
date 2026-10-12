import { describe, expect, it } from 'vitest';
import { accessKey, chaveImpressa, pdfComTexto } from '../../../../test/fiscal-fixtures';
import { findAccessKeys, pdfText } from './pdf-text';

describe('chave de acesso no texto do PDF (DANFE)', () => {
  it('acha a chave impressa em grupos de 4 no PDF', async () => {
    const k = accessKey({ model: '55' });
    const texto = await pdfText(pdfComTexto(['DANFE - Documento Auxiliar da Nota Fiscal Eletronica', 'CHAVE DE ACESSO', chaveImpressa(k), 'VALOR TOTAL DA NOTA 34,89']));
    expect(texto).toContain('CHAVE DE ACESSO');
    expect(findAccessKeys(texto)).toEqual({ kind: 'FOUND', accessKey: k });
  });

  it('chave com pontos ou colada também vale; dígito verificador errado não', () => {
    const k = accessKey();
    expect(findAccessKeys(`Chave: ${k.replace(/(\d{4})(?=\d)/g, '$1.')}`)).toEqual({ kind: 'FOUND', accessKey: k });
    expect(findAccessKeys(`chave ${k}`)).toEqual({ kind: 'FOUND', accessKey: k });
    const errada = k.slice(0, 43) + String((Number(k[43]) + 1) % 10);
    expect(findAccessKeys(`chave ${errada}`)).toEqual({ kind: 'NONE' });
  });

  it('duas chaves diferentes: ambíguo (o organizador escolhe)', () => {
    expect(findAccessKeys(`${accessKey()} e ${accessKey()}`)).toEqual({ kind: 'AMBIGUOUS', count: 2 });
  });

  it('PDF sem chave: NONE', async () => {
    expect(findAccessKeys(await pdfText(pdfComTexto(['Recibo simples', 'Valor 10,00'])))).toEqual({ kind: 'NONE' });
  });
});
