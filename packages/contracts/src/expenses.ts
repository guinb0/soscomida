import { isValidCnpj, isValidCpf, onlyDigits } from '@soscomida/shared';
import { z } from 'zod';
import { budgetCategorySchema } from './campaigns';
import { centsSchema, uuidSchema } from './common';

/**
 * Prestação de contas. O status diz em que ponto da revisão a despesa está;
 * as verificações (fiscal, pagamento, entrega) são independentes e aparecem
 * separadas — uma nota autêntica não prova sozinha o bom uso do dinheiro.
 */
export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Aguardando revisão',
  IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
  CANCELLED: 'Cancelada',
};

export const EXPENSE_DOCUMENT_KINDS = ['FISCAL', 'RECEIPT', 'PAYMENT_PROOF', 'DELIVERY', 'OTHER'] as const;
export const expenseDocumentKindSchema = z.enum(EXPENSE_DOCUMENT_KINDS);
export type ExpenseDocumentKind = z.infer<typeof expenseDocumentKindSchema>;

export const EXPENSE_DOCUMENT_KIND_LABELS: Record<ExpenseDocumentKind, string> = {
  FISCAL: 'Nota fiscal (NF-e/NFC-e)',
  RECEIPT: 'Recibo ou cupom não fiscal',
  PAYMENT_PROOF: 'Comprovante de pagamento',
  DELIVERY: 'Evidência de entrega',
  OTHER: 'Outro documento',
};

/** Avaliação do comprovante de pagamento e da evidência de entrega. */
export const ASSESSMENTS = ['NONE', 'ATTACHED', 'ACCEPTED', 'REJECTED'] as const;
export const assessmentSchema = z.enum(ASSESSMENTS);
export type Assessment = z.infer<typeof assessmentSchema>;

/** Situação fiscal da despesa (pior caso entre as notas anexadas). */
export const FISCAL_CHECKS = ['NONE', 'NOT_VERIFIED', 'AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT', 'UNVERIFIABLE'] as const;
export const fiscalCheckSchema = z.enum(FISCAL_CHECKS);
export type FiscalCheck = z.infer<typeof fiscalCheckSchema>;

export const FISCAL_CHECK_LABELS: Record<FiscalCheck, string> = {
  NONE: 'Sem nota fiscal',
  NOT_VERIFIED: 'Nota ainda não consultada',
  AUTHORIZED: 'Nota autenticada no fisco',
  CANCELLED: 'Nota cancelada no fisco',
  NOT_FOUND: 'Nota não encontrada no fisco',
  DIVERGENT: 'Nota divergente no fisco',
  UNVERIFIABLE: 'Autenticidade não verificável automaticamente',
};

/** Alertas automáticos; nenhum reprova sozinho — orientam a revisão humana. */
export const EXPENSE_FLAGS = [
  'NO_FISCAL_DOCUMENT',
  'AMOUNT_EXCEEDS_FISCAL',
  'SUPPLIER_MISMATCH',
  'DATE_OUTSIDE_CAMPAIGN',
  'OVER_BUDGET_CATEGORY',
  'DUPLICATE_FILE',
  'SHARED_FISCAL_DOCUMENT',
  'FISCAL_NOT_AUTHORIZED_IN_XML',
  'FISCAL_HOMOLOGATION',
  'FISCAL_WARNINGS',
  'FISCAL_TOTAL_DECLARED',
  'NO_PAYMENT_PROOF',
] as const;
export const expenseFlagSchema = z.enum(EXPENSE_FLAGS);
export type ExpenseFlag = z.infer<typeof expenseFlagSchema>;

export const EXPENSE_FLAG_LABELS: Record<ExpenseFlag, string> = {
  NO_FISCAL_DOCUMENT: 'Sem nota fiscal (só recibo ou comprovante)',
  AMOUNT_EXCEEDS_FISCAL: 'Valor da despesa maior que o coberto por notas fiscais',
  SUPPLIER_MISMATCH: 'Fornecedor informado diferente do emitente da nota',
  DATE_OUTSIDE_CAMPAIGN: 'Data fora do período da campanha',
  OVER_BUDGET_CATEGORY: 'Gastos da categoria acima do orçamento aprovado',
  DUPLICATE_FILE: 'Arquivo idêntico já usado em outra despesa',
  SHARED_FISCAL_DOCUMENT: 'Nota fiscal rateada com outra despesa',
  FISCAL_NOT_AUTHORIZED_IN_XML: 'O XML não traz protocolo de autorização (cStat 100)',
  FISCAL_HOMOLOGATION: 'Nota de ambiente de homologação (sem valor fiscal)',
  FISCAL_WARNINGS: 'Incoerências internas na nota (campos x chave de acesso)',
  FISCAL_TOTAL_DECLARED: 'Total da nota informado pelo organizador (não lido do documento)',
  NO_PAYMENT_PROOF: 'Sem comprovante de pagamento',
};

const supplierDocumentSchema = z
  .string()
  .trim()
  .transform(onlyDigits)
  .refine((v) => (v.length === 14 ? isValidCnpj(v) : v.length === 11 ? isValidCpf(v) : false), 'CNPJ ou CPF inválido');

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

export const expenseInputSchema = z.object({
  budgetCategory: budgetCategorySchema,
  description: z.string().trim().min(3, 'Descreva a despesa').max(300),
  supplierName: z.string().trim().min(2, 'Informe o fornecedor').max(160),
  supplierDocument: supplierDocumentSchema.nullable().optional(),
  amountCents: centsSchema.positive('Informe o valor'),
  spentOn: dateOnlySchema,
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const updateExpenseInputSchema = expenseInputSchema.extend({ version: z.number().int() });
export type UpdateExpenseInput = z.infer<typeof updateExpenseInputSchema>;

export const EXPENSE_UPLOAD_TYPES = ['application/xml', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const expenseUploadInputSchema = z.object({
  contentType: z.enum(EXPENSE_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
});

export const attachDocumentInputSchema = z.object({
  fileId: uuidSchema,
  kind: expenseDocumentKindSchema,
  /** Parte do valor da nota atribuída a esta despesa (padrão: o valor da despesa ou o total da nota, o menor). */
  allocatedCents: centsSchema.positive().optional(),
  /** Obrigatória quando a nota já está em outra despesa (rateio). */
  sharingJustification: z.string().trim().min(10).max(500).optional(),
});
export type AttachDocumentInput = z.infer<typeof attachDocumentInputSchema>;

/** Para PDF/foto sem QR: o organizador digita a chave impressa e o total. */
export const fiscalKeyInputSchema = z.object({
  accessKey: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v.length === 44, 'A chave de acesso tem 44 dígitos'),
  declaredTotalCents: centsSchema.positive(),
  allocatedCents: centsSchema.positive().optional(),
  sharingJustification: z.string().trim().min(10).max(500).optional(),
});
export type FiscalKeyInput = z.infer<typeof fiscalKeyInputSchema>;

export const expenseActionInputSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().max(1000).optional(),
});

export const expenseReviewDecisionSchema = z.object({
  version: z.number().int(),
  decision: z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT']),
  reason: z.string().trim().min(5, 'Escreva a justificativa').max(2000),
  paymentProof: z.enum(['ACCEPTED', 'REJECTED']).optional(),
  delivery: z.enum(['ACCEPTED', 'REJECTED']).optional(),
});
export type ExpenseReviewDecision = z.infer<typeof expenseReviewDecisionSchema>;

const fiscalDocumentSchema = z.object({
  id: uuidSchema,
  model: z.enum(['NFE_55', 'NFCE_65']),
  uf: z.string(),
  series: z.number().int(),
  number: z.number().int(),
  issuedAt: z.string().nullable(),
  issuerDocument: z.string(),
  issuerName: z.string().nullable(),
  effectiveTotalCents: centsSchema.nullable(),
  totalSource: z.enum(['DOCUMENT', 'DECLARED']).nullable(),
  source: z.enum(['XML', 'QR_CODE', 'ACCESS_KEY']),
  verificationStatus: z.string(),
  verificationReason: z.string().nullable(),
  items: z.array(z.object({ description: z.string(), quantity: z.string().nullable(), unit: z.string().nullable(), totalCents: centsSchema })),
});

export const expenseDocumentSchema = z.object({
  id: uuidSchema,
  kind: expenseDocumentKindSchema,
  mimeType: z.string(),
  allocatedCents: centsSchema.nullable(),
  sharingJustification: z.string().nullable(),
  /** Leitura automática: o que foi extraído ou por que não deu. */
  extraction: z.object({ status: z.enum(['EXTRACTED', 'NEEDS_ACCESS_KEY', 'NEEDS_TOTAL', 'NOT_APPLICABLE']), message: z.string().nullable() }),
  fiscalDocument: fiscalDocumentSchema.extend({ accessKey: z.string() }).nullable(),
  createdAt: z.string(),
});
export type ExpenseDocument = z.infer<typeof expenseDocumentSchema>;

export const ownedExpenseSchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  status: expenseStatusSchema,
  version: z.number().int(),
  budgetCategory: budgetCategorySchema,
  description: z.string(),
  supplierName: z.string(),
  supplierDocument: z.string().nullable(),
  amountCents: centsSchema,
  spentOn: z.string(),
  fiscalCheck: fiscalCheckSchema,
  paymentProof: assessmentSchema,
  delivery: assessmentSchema,
  flags: z.array(expenseFlagSchema),
  decisionReason: z.string().nullable(),
  documents: z.array(expenseDocumentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OwnedExpense = z.infer<typeof ownedExpenseSchema>;

export const moderationExpenseSchema = ownedExpenseSchema.extend({
  campaign: z.object({ id: uuidSchema, title: z.string(), slug: z.string() }),
  organizerName: z.string(),
  reviewerId: uuidSchema.nullable(),
  budgetSituation: z.object({ plannedCents: centsSchema, committedCents: centsSchema }),
});
export type ModerationExpense = z.infer<typeof moderationExpenseSchema>;

export const expenseQueueItemSchema = z.object({
  id: uuidSchema,
  campaignTitle: z.string(),
  description: z.string(),
  amountCents: centsSchema,
  status: expenseStatusSchema,
  flags: z.array(expenseFlagSchema),
  submittedAt: z.string().nullable(),
});
export type ExpenseQueueItem = z.infer<typeof expenseQueueItemSchema>;

/** O que o público vê: sem arquivos originais, sem CPF, sem chave de acesso. */
export const publicExpenseSchema = z.object({
  id: uuidSchema,
  status: expenseStatusSchema,
  budgetCategory: budgetCategorySchema,
  description: z.string(),
  supplierName: z.string(),
  supplierDocument: z.string().nullable(),
  amountCents: centsSchema,
  spentOn: z.string(),
  fiscalCheck: fiscalCheckSchema,
  paymentProof: assessmentSchema,
  delivery: assessmentSchema,
  decisionReason: z.string().nullable(),
  fiscalDocuments: z.array(fiscalDocumentSchema.omit({ id: true, verificationReason: true })),
});
export type PublicExpense = z.infer<typeof publicExpenseSchema>;
