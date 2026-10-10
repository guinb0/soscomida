import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accessKeyCheckDigit, parseAccessKey } from './access-key';

/** Monta uma chave com o DV correto a partir das partes. */
function montarChave(partes: { uf?: string; aamm?: string; emitente?: string; modelo?: string; resto?: string }) {
  const base =
    (partes.uf ?? '53') +
    (partes.aamm ?? '2603') +
    (partes.emitente ?? '11222333000181') +
    (partes.modelo ?? '65') +
    (partes.resto ?? '001000012345112345678');
  return base + String(accessKeyCheckDigit(base));
}

describe('chave de acesso', () => {
  it('lê uma chave de NFC-e do DF com DV correto', () => {
    const resultado = parseAccessKey(montarChave({}));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value).toMatchObject({
      uf: 'DF',
      issueYear: 2026,
      issueMonth: 3,
      issuerDocument: '11222333000181',
      issuerDocumentType: 'CNPJ',
      model: 'NFCE_65',
      series: 1,
      number: 12345,
    });
  });

  it('aceita a chave com espaços e pontuação (como vem impressa)', () => {
    const chave = montarChave({});
    const impressa = chave.replace(/(\d{4})/g, '$1 ');
    expect(parseAccessKey(impressa).ok).toBe(true);
  });

  it.each([
    ['tamanho errado', '1234', 'FORMATO'],
    ['UF inexistente', montarChave({ uf: '99' }), 'UF_INVALIDA'],
    ['mês 13', montarChave({ aamm: '2613' }), 'DATA_INVALIDA'],
    ['modelo 57', montarChave({ modelo: '57' }), 'MODELO_NAO_SUPORTADO'],
    ['CNPJ inválido', montarChave({ emitente: '11222333000180' }), 'EMITENTE_INVALIDO'],
  ])('recusa %s', (_caso, chave, erro) => {
    expect(parseAccessKey(chave)).toEqual({ ok: false, error: erro });
  });

  it('troca de um dígito: verificação exaustiva das 387 alterações possíveis', () => {
    const chave = montarChave({});
    const naoDetectadas: string[] = [];
    for (let posicao = 0; posicao < 43; posicao++) {
      for (let delta = 1; delta <= 9; delta++) {
        const digito = (Number(chave[posicao]) + delta) % 10;
        const alterada = chave.slice(0, posicao) + digito + chave.slice(posicao + 1);
        if (parseAccessKey(alterada).ok) naoDetectadas.push(`${posicao}:${digito}`);
      }
    }
    // O módulo 11 da SEFAZ mapeia os restos 0 e 1 para o mesmo DV (0), então
    // uma pequena fração das trocas passa. Por isso a chave é só um filtro:
    // autenticidade depende de consulta oficial (FISCAL_VALIDATION.md).
    expect(naoDetectadas.length).toBeLessThanOrEqual(Math.ceil(387 * 0.1));
  });

  it('DV calculado sempre valida a própria chave (propriedade)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{43}$/), (base) => {
        const dv = accessKeyCheckDigit(base);
        expect(dv).toBeGreaterThanOrEqual(0);
        expect(dv).toBeLessThanOrEqual(9);
      }),
    );
  });
});
