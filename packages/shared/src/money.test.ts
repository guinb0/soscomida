import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidMoneyError, addCents, cents, formatBrl, parseBrl, percentOf } from './money';

describe('dinheiro em centavos', () => {
  it('recusa fração e valores fora do inteiro seguro', () => {
    expect(() => cents(10.5)).toThrow(InvalidMoneyError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidMoneyError);
    expect(() => cents(Number.NaN)).toThrow(InvalidMoneyError);
  });

  it.each([
    ['10', 1000],
    ['10,5', 1050],
    ['10,05', 1005],
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['1234.56', 123456],
    ['0,01', 1],
  ])('lê "%s" como %i centavos', (texto, esperado) => {
    expect(parseBrl(texto)).toBe(esperado);
  });

  it.each(['', 'abc', '1,234', '10,555', '-5', '1.23.4'])('recusa "%s"', (texto) => {
    expect(() => parseBrl(texto)).toThrow(InvalidMoneyError);
  });

  it('formata em reais, inclusive negativos menores que 1 real', () => {
    expect(formatBrl(123456)).toBe('R$ 1.234,56');
    expect(formatBrl(5)).toBe('R$ 0,05');
    expect(formatBrl(-50)).toBe('-R$ 0,50');
  });

  it('formatar e ler de volta preserva o valor (propriedade)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_00 }), (v) => {
        const texto = formatBrl(v).replace('R$', '').trim();
        expect(parseBrl(texto)).toBe(v);
      }),
    );
  });

  it('soma é exata para qualquer lista de inteiros (propriedade)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 200 }), (valores) => {
        expect(addCents(...valores)).toBe(valores.reduce((a, b) => a + b, 0));
      }),
    );
  });

  it('percentual é inteiro e arredonda para baixo', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(150, 100)).toBe(150);
    expect(percentOf(10, 0)).toBe(0);
  });
});
