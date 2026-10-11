/**
 * Valores monetários são sempre inteiros em centavos. `number` é seguro até
 * Number.MAX_SAFE_INTEGER centavos (~R$ 90 trilhões); qualquer valor fora
 * disso, fracionário ou não finito é rejeitado em vez de arredondado.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidMoneyError(`Valor em centavos inválido: ${value}`);
  }
  return value as Cents;
}

export function addCents(...values: number[]): Cents {
  return cents(values.reduce((total, v) => total + cents(v), 0));
}

export function subtractCents(a: number, b: number): Cents {
  return cents(cents(a) - cents(b));
}

/**
 * Converte texto digitado ("1.234,56", "1234.56", "10") para centavos sem
 * passar por ponto flutuante.
 */
export function parseBrl(input: string): Cents {
  const limpo = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(limpo);
  if (!match) {
    throw new InvalidMoneyError(`Valor monetário inválido: "${input}"`);
  }
  const inteiros = match[1]!.replace(/\./g, '');
  const fracao = (match[2] ?? '').padEnd(2, '0');
  return cents(Number(inteiros) * 100 + Number(fracao));
}

const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBrl(value: number): string {
  const v = cents(value);
  const absoluto = Math.abs(v);
  const sinal = v < 0 ? '-' : '';
  // Monta a partir de inteiros para não depender de v / 100 em ponto flutuante.
  const texto = `${sinal}${Math.trunc(absoluto / 100)}.${String(absoluto % 100).padStart(2, '0')}`;
  return formatador.format(Number(texto));
}

/** Percentual inteiro (0–100+) de `part` sobre `whole`, sem ponto flutuante acumulado. */
export function percentOf(part: number, whole: number): number {
  if (cents(whole) <= 0) return 0;
  return Math.floor((cents(part) * 100) / whole);
}

/**
 * Decimal com ponto e até 2 casas, como nos XMLs fiscais ("1234.5" → 123450).
 * Sem passar por float.
 */
export function decimalToCents(input: string): Cents {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new InvalidMoneyError(`Decimal inválido: "${input}"`);
  return cents(Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')));
}
