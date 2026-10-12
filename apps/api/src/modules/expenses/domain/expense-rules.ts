import type { Assessment, ExpenseFlag, ExpenseStatus, FiscalCheck } from '@soscomida/contracts';

export type ExpenseAction = 'submit' | 'withdraw' | 'cancel' | 'claim' | 'approve' | 'request_changes' | 'reject' | 'appeal';
export type ExpenseActor = 'organizer' | 'reviewer';

const TRANSICOES: Record<ExpenseAction, { from: ExpenseStatus[]; to: ExpenseStatus; actor: ExpenseActor; reason: boolean }> = {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', actor: 'organizer', reason: false },
  withdraw: { from: ['SUBMITTED'], to: 'DRAFT', actor: 'organizer', reason: false },
  cancel: { from: ['DRAFT'], to: 'CANCELLED', actor: 'organizer', reason: false },
  claim: { from: ['SUBMITTED'], to: 'IN_REVIEW', actor: 'reviewer', reason: false },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED', actor: 'reviewer', reason: true },
  request_changes: { from: ['IN_REVIEW'], to: 'DRAFT', actor: 'reviewer', reason: true },
  reject: { from: ['IN_REVIEW'], to: 'REJECTED', actor: 'reviewer', reason: true },
  // Contestação: a recusa volta para a fila e outra pessoa revisa (uma vez só; ver ExpensesService.appeal).
  appeal: { from: ['REJECTED'], to: 'SUBMITTED', actor: 'organizer', reason: true },
};

export type ExpenseTransition = { ok: true; to: ExpenseStatus } | { ok: false; error: 'INVALID_TRANSITION' | 'ACTOR_NOT_ALLOWED' | 'REASON_REQUIRED' };

export function expenseTransition(action: ExpenseAction, from: ExpenseStatus, actor: ExpenseActor, reason?: string | null): ExpenseTransition {
  const t = TRANSICOES[action];
  if (!t.from.includes(from)) return { ok: false, error: 'INVALID_TRANSITION' };
  if (t.actor !== actor) return { ok: false, error: 'ACTOR_NOT_ALLOWED' };
  if (t.reason && !reason?.trim()) return { ok: false, error: 'REASON_REQUIRED' };
  return { ok: true, to: t.to };
}

export const organizerActions = (status: ExpenseStatus): ExpenseAction[] =>
  (Object.keys(TRANSICOES) as ExpenseAction[]).filter((a) => TRANSICOES[a].actor === 'organizer' && TRANSICOES[a].from.includes(status));

/** Status que contam para o total gasto (e para o rateio das notas). */
export const COUNTED_STATUSES: readonly ExpenseStatus[] = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED'];

const GRAVIDADE: FiscalCheck[] = ['AUTHORIZED', 'NOT_VERIFIED', 'UNVERIFIABLE', 'NOT_FOUND', 'DIVERGENT', 'CANCELLED'];

/** Situação fiscal da despesa: a pior entre as notas; NONE sem nota. */
export function aggregateFiscalCheck(statuses: string[]): FiscalCheck {
  if (statuses.length === 0) return 'NONE';
  let pior: FiscalCheck = 'AUTHORIZED';
  for (const s of statuses) {
    const atual = (GRAVIDADE.includes(s as FiscalCheck) ? s : 'NOT_VERIFIED') as FiscalCheck;
    if (GRAVIDADE.indexOf(atual) > GRAVIDADE.indexOf(pior)) pior = atual;
  }
  return pior;
}

/** ATTACHED quando há documento do tipo e ninguém avaliou ainda. */
export function initialAssessment(current: Assessment, hasDocument: boolean): Assessment {
  if (current === 'ACCEPTED' || current === 'REJECTED') return current;
  return hasDocument ? 'ATTACHED' : 'NONE';
}

export interface FlagInput {
  amountCents: number;
  spentOn: string;
  supplierDocument: string | null;
  campaign: { createdAt: Date; endsAt: Date };
  /** Orçamento da categoria e quanto já está comprometido nela, incluindo esta despesa. */
  category: { plannedCents: number; committedCents: number };
  fiscal: {
    allocatedCents: number;
    issuerDocument: string;
    issuedAt: string | null;
    protocolStatus: number | null;
    source: 'XML' | 'QR_CODE' | 'ACCESS_KEY';
    environment: number | null;
    warnings: string[];
    totalFromDocument: boolean;
    sharedWithOtherExpenses: boolean;
    /** Assinatura do XML (null quando a nota não veio de XML). */
    signatureStatus: 'VALID' | 'MISSING' | 'INVALID' | null;
    /** Problemas do certificado de uma assinatura íntegra (CNPJ, validade, autoassinado). */
    certificateProblems: number;
  }[];
  hasPaymentProof: boolean;
  duplicateFile: boolean;
  /** Imagem visualmente igual (hash perceptual) a uma usada em outra despesa. */
  similarImage: boolean;
  /** Pré-filtro achou ordens ao sistema nos textos enviados. */
  suspiciousInstructions: boolean;
}

/** Dias de tolerância depois do prazo: compras feitas após o encerramento ainda valem. */
const TOLERANCIA_APOS_PRAZO_DIAS = 180;

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Alertas automáticos. Nenhum reprova a despesa sozinho: todos vão para a
 * pessoa que revisa, e os relevantes ao público aparecem na página.
 */
export function computeFlags(i: FlagInput): ExpenseFlag[] {
  const flags = new Set<ExpenseFlag>();
  const inicio = dia(i.campaign.createdAt);
  const fim = dia(new Date(i.campaign.endsAt.getTime() + TOLERANCIA_APOS_PRAZO_DIAS * 86_400_000));
  const foraDoPeriodo = (d: string) => d < inicio || d > fim;

  if (i.fiscal.length === 0) flags.add('NO_FISCAL_DOCUMENT');
  else if (i.fiscal.reduce((t, f) => t + f.allocatedCents, 0) < i.amountCents) flags.add('AMOUNT_EXCEEDS_FISCAL');

  if (foraDoPeriodo(i.spentOn)) flags.add('DATE_OUTSIDE_CAMPAIGN');
  if (i.category.committedCents > i.category.plannedCents) flags.add('OVER_BUDGET_CATEGORY');
  if (i.duplicateFile) flags.add('DUPLICATE_FILE');
  if (i.similarImage) flags.add('SIMILAR_IMAGE');
  if (i.suspiciousInstructions) flags.add('SUSPICIOUS_INSTRUCTIONS');
  if (!i.hasPaymentProof) flags.add('NO_PAYMENT_PROOF');

  for (const f of i.fiscal) {
    if (i.supplierDocument && f.issuerDocument !== i.supplierDocument) flags.add('SUPPLIER_MISMATCH');
    if (f.issuedAt && foraDoPeriodo(f.issuedAt.slice(0, 10))) flags.add('DATE_OUTSIDE_CAMPAIGN');
    if (f.source === 'XML' && f.protocolStatus !== 100) flags.add('FISCAL_NOT_AUTHORIZED_IN_XML');
    if (f.environment === 2) flags.add('FISCAL_HOMOLOGATION');
    if (f.warnings.length > 0) flags.add('FISCAL_WARNINGS');
    if (!f.totalFromDocument) flags.add('FISCAL_TOTAL_DECLARED');
    if (f.sharedWithOtherExpenses) flags.add('SHARED_FISCAL_DOCUMENT');
    if (f.source === 'XML' && f.signatureStatus === 'MISSING') flags.add('XML_SIGNATURE_MISSING');
    if (f.source === 'XML' && f.signatureStatus === 'INVALID') flags.add('XML_SIGNATURE_INVALID');
    if (f.source === 'XML' && f.signatureStatus === 'VALID' && f.certificateProblems > 0) flags.add('XML_SIGNATURE_CERTIFICATE');
  }
  return [...flags];
}
