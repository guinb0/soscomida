import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Posting,
  UnbalancedPostingError,
  assertBalanced,
  balanceOf,
  donationConfirmedPosting,
  donationRefundedPosting,
} from './postings';

const CAMPANHA = '0190f000-0000-7000-8000-000000000001';

/** Aplica uma sequência de lançamentos em memória, como o banco faria. */
function aplicar(postings: Posting[]) {
  const contas = new Map<string, { kind: Parameters<typeof balanceOf>[0]; debits: number; credits: number }>();
  for (const p of postings) {
    assertBalanced(p);
    for (const l of p.lines) {
      const conta = contas.get(l.accountCode) ?? { kind: l.accountKind, debits: 0, credits: 0 };
      if (l.direction === 'DEBIT') conta.debits += l.amountCents;
      else conta.credits += l.amountCents;
      contas.set(l.accountCode, conta);
    }
  }
  const saldo = (codigo: string) => {
    const c = contas.get(codigo);
    return c ? balanceOf(c.kind, c.debits, c.credits) : 0;
  };
  const totalDebitos = [...contas.values()].reduce((t, c) => t + c.debits, 0);
  const totalCreditos = [...contas.values()].reduce((t, c) => t + c.credits, 0);
  return { saldo, totalDebitos, totalCreditos };
}

describe('lançamentos de doação', () => {
  it('confirmação sem tarifa: bruto a receber do provedor e devido à campanha', () => {
    const p = donationConfirmedPosting({ donationId: 'd1', campaignId: CAMPANHA, provider: 'asaas', grossCents: 5000, feeCents: 0 });
    expect(p.lines).toHaveLength(2);
    const r = aplicar([p]);
    expect(r.saldo(`campaign:${CAMPANHA}:donations`)).toBe(5000);
    expect(r.saldo('provider:asaas:receivable')).toBe(5000);
  });

  it('confirmação com tarifa: a tarifa sai da campanha e do valor a receber', () => {
    const r = aplicar([donationConfirmedPosting({ donationId: 'd1', campaignId: CAMPANHA, provider: 'asaas', grossCents: 10000, feeCents: 199 })]);
    expect(r.saldo(`campaign:${CAMPANHA}:donations`)).toBe(10000);
    expect(r.saldo(`campaign:${CAMPANHA}:fees`)).toBe(199);
    expect(r.saldo('provider:asaas:receivable')).toBe(9801);
  });

  it('recusa tarifa maior que o bruto ou negativa', () => {
    expect(() => donationConfirmedPosting({ donationId: 'd', campaignId: CAMPANHA, provider: 'asaas', grossCents: 100, feeCents: 101 })).toThrow(
      UnbalancedPostingError,
    );
    expect(() => donationConfirmedPosting({ donationId: 'd', campaignId: CAMPANHA, provider: 'asaas', grossCents: 100, feeCents: -1 })).toThrow();
  });

  it('chaves de idempotência distintas para confirmar e estornar a mesma doação', () => {
    const c = donationConfirmedPosting({ donationId: 'd9', campaignId: CAMPANHA, provider: 'asaas', grossCents: 100, feeCents: 0 });
    const e = donationRefundedPosting({ donationId: 'd9', campaignId: CAMPANHA, provider: 'asaas', refundedCents: 100 });
    expect(c.idempotencyKey).toBe('donation:d9:confirmed');
    expect(e.idempotencyKey).toBe('donation:d9:refunded');
  });

  it('recusa transação desbalanceada', () => {
    const p = donationConfirmedPosting({ donationId: 'd', campaignId: CAMPANHA, provider: 'asaas', grossCents: 100, feeCents: 0 });
    p.lines[0]!.amountCents = 99;
    expect(() => assertBalanced(p)).toThrow(/desbalanceada/);
  });
});

describe('invariantes do ledger (propriedades)', () => {
  const doacao = fc.record({
    grossCents: fc.integer({ min: 500, max: 5_000_000 }),
    feeBasisPoints: fc.integer({ min: 0, max: 1000 }),
    estornada: fc.boolean(),
  });

  it('qualquer sequência de confirmações e estornos fecha Σ débitos = Σ créditos', () => {
    fc.assert(
      fc.property(fc.array(doacao, { maxLength: 60 }), (doacoes) => {
        const postings: Posting[] = [];
        doacoes.forEach((d, i) => {
          const fee = Math.floor((d.grossCents * d.feeBasisPoints) / 10_000);
          postings.push(donationConfirmedPosting({ donationId: `d${i}`, campaignId: CAMPANHA, provider: 'asaas', grossCents: d.grossCents, feeCents: fee }));
          if (d.estornada) {
            postings.push(donationRefundedPosting({ donationId: `d${i}`, campaignId: CAMPANHA, provider: 'asaas', refundedCents: d.grossCents }));
          }
        });
        const r = aplicar(postings);
        expect(r.totalDebitos).toBe(r.totalCreditos);
      }),
    );
  });

  it('arrecadado − tarifas − estornos = saldo a receber do provedor', () => {
    fc.assert(
      fc.property(fc.array(doacao, { maxLength: 60 }), (doacoes) => {
        const postings: Posting[] = [];
        let esperadoArrecadado = 0;
        doacoes.forEach((d, i) => {
          const fee = Math.floor((d.grossCents * d.feeBasisPoints) / 10_000);
          esperadoArrecadado += d.grossCents;
          postings.push(donationConfirmedPosting({ donationId: `d${i}`, campaignId: CAMPANHA, provider: 'asaas', grossCents: d.grossCents, feeCents: fee }));
          if (d.estornada) postings.push(donationRefundedPosting({ donationId: `d${i}`, campaignId: CAMPANHA, provider: 'asaas', refundedCents: d.grossCents }));
        });
        const r = aplicar(postings);
        const arrecadado = r.saldo(`campaign:${CAMPANHA}:donations`);
        const tarifas = r.saldo(`campaign:${CAMPANHA}:fees`);
        const estornos = r.saldo(`campaign:${CAMPANHA}:refunds`);
        expect(arrecadado).toBe(esperadoArrecadado);
        expect(arrecadado - tarifas - estornos).toBe(r.saldo('provider:asaas:receivable'));
        expect(arrecadado).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
