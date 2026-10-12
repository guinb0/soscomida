import { describe, expect, it } from 'vitest';
import { type FlagInput, aggregateFiscalCheck, computeFlags, expenseTransition, organizerActions } from './expense-rules';

const fiscal = (over: Partial<FlagInput['fiscal'][number]> = {}): FlagInput['fiscal'][number] => ({
  allocatedCents: 10_000,
  issuerDocument: '11222333000181',
  issuedAt: '2026-10-05T10:00:00-03:00',
  protocolStatus: 100,
  source: 'XML',
  environment: 1,
  warnings: [],
  totalFromDocument: true,
  sharedWithOtherExpenses: false,
  signatureStatus: 'VALID',
  certificateProblems: 0,
  ...over,
});

const base = (over: Partial<FlagInput> = {}): FlagInput => ({
  amountCents: 10_000,
  spentOn: '2026-10-05',
  supplierDocument: '11222333000181',
  campaign: { createdAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') },
  category: { plannedCents: 50_000, committedCents: 10_000 },
  fiscal: [fiscal()],
  hasPaymentProof: true,
  duplicateFile: false,
  similarImage: false,
  suspiciousInstructions: false,
  ...over,
});

describe('máquina de estados da despesa', () => {
  it('organizador envia e retira; revisor assume e decide', () => {
    expect(expenseTransition('submit', 'DRAFT', 'organizer')).toEqual({ ok: true, to: 'SUBMITTED' });
    expect(expenseTransition('claim', 'SUBMITTED', 'reviewer')).toEqual({ ok: true, to: 'IN_REVIEW' });
    expect(expenseTransition('approve', 'IN_REVIEW', 'reviewer', 'ok, conferido')).toEqual({ ok: true, to: 'APPROVED' });
    expect(expenseTransition('request_changes', 'IN_REVIEW', 'reviewer', 'falta comprovante')).toEqual({ ok: true, to: 'DRAFT' });
  });

  it('recusa transição inválida, ator errado e decisão sem justificativa', () => {
    expect(expenseTransition('approve', 'DRAFT', 'reviewer', 'x')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
    expect(expenseTransition('approve', 'IN_REVIEW', 'organizer', 'x')).toEqual({ ok: false, error: 'ACTOR_NOT_ALLOWED' });
    expect(expenseTransition('reject', 'IN_REVIEW', 'reviewer', '  ')).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(expenseTransition('submit', 'APPROVED', 'organizer')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('aprovada é final; recusada só pode ser contestada, com justificativa', () => {
    expect(organizerActions('APPROVED')).toEqual([]);
    expect(organizerActions('REJECTED')).toEqual(['appeal']);
    expect(expenseTransition('appeal', 'REJECTED', 'organizer', 'A nota é de alimentos, veja os itens.')).toEqual({ ok: true, to: 'SUBMITTED' });
    expect(expenseTransition('appeal', 'REJECTED', 'organizer', '')).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(expenseTransition('appeal', 'APPROVED', 'organizer', 'x')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
    expect(organizerActions('DRAFT').sort()).toEqual(['cancel', 'submit']);
  });
});

describe('situação fiscal agregada', () => {
  it('é a pior entre as notas', () => {
    expect(aggregateFiscalCheck([])).toBe('NONE');
    expect(aggregateFiscalCheck(['AUTHORIZED', 'AUTHORIZED'])).toBe('AUTHORIZED');
    expect(aggregateFiscalCheck(['AUTHORIZED', 'UNVERIFIABLE'])).toBe('UNVERIFIABLE');
    expect(aggregateFiscalCheck(['NOT_FOUND', 'CANCELLED', 'AUTHORIZED'])).toBe('CANCELLED');
    expect(aggregateFiscalCheck(['NOT_VERIFIED', 'AUTHORIZED'])).toBe('NOT_VERIFIED');
  });
});

describe('alertas automáticos', () => {
  it('despesa redonda não gera alerta', () => {
    expect(computeFlags(base())).toEqual([]);
  });

  it('sem nota e sem comprovante', () => {
    expect(computeFlags(base({ fiscal: [], hasPaymentProof: false })).sort()).toEqual(['NO_FISCAL_DOCUMENT', 'NO_PAYMENT_PROOF']);
  });

  it('valor acima do coberto pelas notas, fornecedor diferente, fora do período, acima do orçamento', () => {
    const flags = computeFlags(
      base({
        amountCents: 20_000,
        supplierDocument: '11444777000161',
        spentOn: '2026-09-01',
        category: { plannedCents: 50_000, committedCents: 60_000 },
      }),
    );
    expect(flags.sort()).toEqual(['AMOUNT_EXCEEDS_FISCAL', 'DATE_OUTSIDE_CAMPAIGN', 'OVER_BUDGET_CATEGORY', 'SUPPLIER_MISMATCH']);
  });

  it('compra até 180 dias depois do prazo ainda está no período', () => {
    expect(computeFlags(base({ spentOn: '2027-04-29' }))).toEqual([]);
    expect(computeFlags(base({ spentOn: '2027-05-01' }))).toEqual(['DATE_OUTSIDE_CAMPAIGN']);
  });

  it('sinais da própria nota', () => {
    const flags = computeFlags(
      base({
        fiscal: [fiscal({ protocolStatus: null, environment: 2, warnings: ['x'], totalFromDocument: false, sharedWithOtherExpenses: true })],
      }),
    );
    expect(flags.sort()).toEqual(['FISCAL_HOMOLOGATION', 'FISCAL_NOT_AUTHORIZED_IN_XML', 'FISCAL_TOTAL_DECLARED', 'FISCAL_WARNINGS', 'SHARED_FISCAL_DOCUMENT']);
  });

  it('nota lida do QR Code não exige protocolo no XML', () => {
    expect(computeFlags(base({ fiscal: [fiscal({ source: 'QR_CODE', protocolStatus: null })] }))).toEqual([]);
  });

  it('assinatura do XML: ausente, inválida ou com certificado que não confere', () => {
    expect(computeFlags(base({ fiscal: [fiscal({ signatureStatus: 'MISSING' })] }))).toEqual(['XML_SIGNATURE_MISSING']);
    expect(computeFlags(base({ fiscal: [fiscal({ signatureStatus: 'INVALID' })] }))).toEqual(['XML_SIGNATURE_INVALID']);
    expect(computeFlags(base({ fiscal: [fiscal({ certificateProblems: 1 })] }))).toEqual(['XML_SIGNATURE_CERTIFICATE']);
    // Nota lida do QR ou da chave não tem assinatura para conferir.
    expect(computeFlags(base({ fiscal: [fiscal({ source: 'QR_CODE', signatureStatus: null })] }))).toEqual([]);
  });

  it('imagem parecida com a de outra despesa e instruções embutidas', () => {
    expect(computeFlags(base({ similarImage: true, suspiciousInstructions: true })).sort()).toEqual(['SIMILAR_IMAGE', 'SUSPICIOUS_INSTRUCTIONS']);
  });
});
