import { cents } from '@soscomida/shared';

export type AccountKind = 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE';
export type Direction = 'DEBIT' | 'CREDIT';

export interface PostingLine {
  accountCode: string;
  accountKind: AccountKind;
  campaignId: string | null;
  direction: Direction;
  amountCents: number;
}

export interface Posting {
  kind: string;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  campaignId: string | null;
  description: string;
  lines: PostingLine[];
}

export class UnbalancedPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnbalancedPostingError';
  }
}

/** Valida antes de gravar: valores inteiros positivos e Σ débitos = Σ créditos. */
export function assertBalanced(posting: Posting): void {
  if (posting.lines.length < 2) throw new UnbalancedPostingError('Uma transação precisa de ao menos dois lançamentos');
  let debitos = 0;
  let creditos = 0;
  for (const linha of posting.lines) {
    const valor = cents(linha.amountCents);
    if (valor <= 0) throw new UnbalancedPostingError(`Lançamento com valor não positivo: ${valor}`);
    if (linha.direction === 'DEBIT') debitos += valor;
    else creditos += valor;
  }
  if (debitos !== creditos) {
    throw new UnbalancedPostingError(`Transação desbalanceada: débitos ${debitos} ≠ créditos ${creditos}`);
  }
}

// --- Plano de contas (docs/PAYMENTS.md) -------------------------------------

export const accounts = {
  providerReceivable: (provider: string) => ({ code: `provider:${provider}:receivable`, kind: 'ASSET' as const, campaignId: null }),
  campaignDonations: (campaignId: string) => ({ code: `campaign:${campaignId}:donations`, kind: 'LIABILITY' as const, campaignId }),
  campaignFees: (campaignId: string) => ({ code: `campaign:${campaignId}:fees`, kind: 'EXPENSE' as const, campaignId }),
  campaignRefunds: (campaignId: string) => ({ code: `campaign:${campaignId}:refunds`, kind: 'EXPENSE' as const, campaignId }),
  campaignTransfers: (campaignId: string) => ({ code: `campaign:${campaignId}:transfers`, kind: 'EXPENSE' as const, campaignId }),
};

type Account = ReturnType<(typeof accounts)[keyof typeof accounts]>;

const line = (account: Account, direction: Direction, amountCents: number): PostingLine => ({
  accountCode: account.code,
  accountKind: account.kind,
  campaignId: account.campaignId,
  direction,
  amountCents,
});

export const LEDGER_KINDS = {
  donationConfirmed: 'donation_confirmed',
  donationRefunded: 'donation_refunded',
} as const;

/**
 * Doação confirmada pelo provedor: o bruto entra a receber do provedor e
 * fica devido à campanha; a tarifa sai da campanha.
 */
export function donationConfirmedPosting(input: {
  donationId: string;
  campaignId: string;
  provider: string;
  grossCents: number;
  feeCents: number;
}): Posting {
  const gross = cents(input.grossCents);
  const fee = cents(input.feeCents);
  if (fee < 0 || fee > gross) throw new UnbalancedPostingError(`Tarifa inválida: ${fee} sobre ${gross}`);

  const lines = [
    line(accounts.providerReceivable(input.provider), 'DEBIT', gross),
    line(accounts.campaignDonations(input.campaignId), 'CREDIT', gross),
  ];
  if (fee > 0) {
    lines.push(line(accounts.campaignFees(input.campaignId), 'DEBIT', fee));
    lines.push(line(accounts.providerReceivable(input.provider), 'CREDIT', fee));
  }
  return {
    kind: LEDGER_KINDS.donationConfirmed,
    idempotencyKey: `donation:${input.donationId}:confirmed`,
    referenceType: 'donation',
    referenceId: input.donationId,
    campaignId: input.campaignId,
    description: 'Doação confirmada pelo provedor de pagamento',
    lines,
  };
}

/** Estorno total: devolve o bruto ao doador a partir do que estava a receber do provedor. */
export function donationRefundedPosting(input: {
  donationId: string;
  campaignId: string;
  provider: string;
  refundedCents: number;
}): Posting {
  const valor = cents(input.refundedCents);
  return {
    kind: LEDGER_KINDS.donationRefunded,
    idempotencyKey: `donation:${input.donationId}:refunded`,
    referenceType: 'donation',
    referenceId: input.donationId,
    campaignId: input.campaignId,
    description: 'Doação estornada',
    lines: [
      line(accounts.campaignRefunds(input.campaignId), 'DEBIT', valor),
      line(accounts.providerReceivable(input.provider), 'CREDIT', valor),
    ],
  };
}

/** Saldo de uma conta pela sua natureza: ativos e despesas crescem a débito; passivos e receitas, a crédito. */
export function balanceOf(kind: AccountKind, debits: number, credits: number): number {
  return kind === 'ASSET' || kind === 'EXPENSE' ? debits - credits : credits - debits;
}
