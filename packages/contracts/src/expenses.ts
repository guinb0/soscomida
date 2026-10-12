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
  'XML_SIGNATURE_MISSING',
  'XML_SIGNATURE_INVALID',
  'XML_SIGNATURE_CERTIFICATE',
  'SIMILAR_IMAGE',
  'SUSPICIOUS_INSTRUCTIONS',
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
  XML_SIGNATURE_MISSING: 'XML sem assinatura digital do emitente',
  XML_SIGNATURE_INVALID: 'Assinatura digital do XML inválida: arquivo alterado ou montado',
  XML_SIGNATURE_CERTIFICATE: 'Certificado da assinatura não confere (CNPJ, validade ou autoassinado)',
  SIMILAR_IMAGE: 'Imagem muito parecida com outra já usada em outra despesa',
  SUSPICIOUS_INSTRUCTIONS: 'Texto com ordens para o sistema ou para a revisão (possível manipulação)',
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
  /** Assinatura XMLDSig do emitente (só XML). */
  signature: z.object({ status: z.enum(['VALID', 'MISSING', 'INVALID']), problems: z.array(z.string()), certificateSubject: z.string().nullable() }).nullable(),
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
  /** Contestação de uma recusa (uma por despesa). */
  appeal: z.object({ reason: z.string(), at: z.string() }).nullable(),
  documents: z.array(expenseDocumentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OwnedExpense = z.infer<typeof ownedExpenseSchema>;

// --- Análise automática (Fase 3) ---------------------------------------------

export const ADHERENCE_CLASSIFICATIONS = ['COMPATIBLE', 'POSSIBLY_COMPATIBLE', 'INCOMPATIBLE', 'INSUFFICIENT_EVIDENCE', 'REQUIRES_HUMAN_REVIEW'] as const;
export type AdherenceClassification = (typeof ADHERENCE_CLASSIFICATIONS)[number];
export const ADHERENCE_LABELS: Record<AdherenceClassification, string> = {
  COMPATIBLE: 'Compatível com a finalidade',
  POSSIBLY_COMPATIBLE: 'Possivelmente compatível',
  INCOMPATIBLE: 'Incompatível com a finalidade',
  INSUFFICIENT_EVIDENCE: 'Evidência insuficiente',
  REQUIRES_HUMAN_REVIEW: 'Precisa de análise humana',
};

export const ADHERENCE_ISSUE_CODES = [
  'ITEM_FORA_DA_FINALIDADE',
  'VALOR_INCOMPATIVEL',
  'QUANTIDADE_ATIPICA',
  'FORNECEDOR_INCOMPATIVEL',
  'DESCRICAO_DIVERGENTE_DOS_ITENS',
  'PROMPT_INJECTION_SUSPECT',
  'OUTRO',
] as const;

/** Saída exigida do modelo (validada; inválida duas vezes = revisão humana). */
export const adherenceOutputSchema = z.object({
  classification: z.enum(ADHERENCE_CLASSIFICATIONS),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  purposeAlignment: z.number().min(0).max(1),
  detectedIssues: z
    .array(z.object({ code: z.enum(ADHERENCE_ISSUE_CODES).catch('OUTRO'), item: z.string().max(200).nullable().optional(), detail: z.string().max(500) }))
    .max(20),
  supportingEvidence: z.array(z.string().max(300)).max(10),
  missingEvidence: z.array(z.string().max(300)).max(10),
  recommendation: z.enum(['APPROVE', 'REVIEW', 'REJECT_SUGGESTED']),
  explanation: z.string().min(1).max(1200),
});
export type AdherenceOutput = z.infer<typeof adherenceOutputSchema>;

export const AI_STATUSES = ['COMPLETED', 'NO_PROVIDER', 'BUDGET_EXHAUSTED', 'INVALID_OUTPUT', 'PROVIDER_ERROR'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];
export const AI_STATUS_LABELS: Record<AiStatus, string> = {
  COMPLETED: 'Análise de IA concluída',
  NO_PROVIDER: 'IA não configurada: só regras automáticas',
  BUDGET_EXHAUSTED: 'Orçamento de IA do mês esgotado: só regras automáticas',
  INVALID_OUTPUT: 'A IA respondeu fora do formato duas vezes: só regras automáticas',
  PROVIDER_ERROR: 'Provedor de IA indisponível: só regras automáticas',
};

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { LOW: 'Risco baixo', MEDIUM: 'Risco médio', HIGH: 'Risco alto' };

export const riskFactorSchema = z.object({ code: z.string(), label: z.string(), points: z.number().int(), source: z.enum(['RULE', 'FISCAL', 'AI']) });

export const expenseAnalysisSchema = z.object({
  id: uuidSchema,
  createdAt: z.string(),
  trigger: z.enum(['SUBMITTED', 'MANUAL']),
  expenseVersion: z.number().int(),
  rulesetVersion: z.string(),
  risk: z.object({ score: z.number().int().min(0).max(100), level: z.enum(RISK_LEVELS), factors: z.array(riskFactorSchema) }),
  ai: z.object({
    status: z.enum(AI_STATUSES),
    provider: z.string(),
    model: z.string().nullable(),
    promptVersion: z.string(),
    /** true quando o "modelo" é o simulador local de desenvolvimento. */
    simulated: z.boolean(),
    output: adherenceOutputSchema.nullable(),
    detail: z.string().nullable(),
  }),
  suspiciousInstructions: z.array(z.object({ code: z.string(), excerpt: z.string() })),
});
export type ExpenseAnalysis = z.infer<typeof expenseAnalysisSchema>;

export const appealInputSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().min(20, 'Explique em pelo menos 20 caracteres por que a decisão deve ser revista').max(2000),
});
export type AppealInput = z.infer<typeof appealInputSchema>;

export const moderationExpenseSchema = ownedExpenseSchema.extend({
  campaign: z.object({ id: uuidSchema, title: z.string(), slug: z.string() }),
  organizerName: z.string(),
  reviewerId: uuidSchema.nullable(),
  budgetSituation: z.object({ plannedCents: centsSchema, committedCents: centsSchema }),
  /** Quem recusou antes da contestação não revisa de novo. */
  rejectedBy: uuidSchema.nullable(),
  analysis: expenseAnalysisSchema.nullable(),
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
  riskScore: z.number().int().nullable(),
  riskLevel: z.enum(RISK_LEVELS).nullable(),
  appealed: z.boolean(),
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
  /** A recusa foi contestada pelo organizador e está em nova revisão. */
  appealed: z.boolean(),
  fiscalDocuments: z.array(fiscalDocumentSchema.omit({ id: true, verificationReason: true })),
});
export type PublicExpense = z.infer<typeof publicExpenseSchema>;

// --- Política de risco (editável pela administração) ---------------------------

const pontos = z.number().int().min(0).max(100);
export const RISK_FISCAL_KEYS = ['CANCELLED', 'NOT_FOUND', 'DIVERGENT'] as const;

/** Pesos e limites do motor de risco. Cada alteração vira uma nova versão (histórico só-inserção). */
export const riskPolicyRulesSchema = z
  .object({
    flagPoints: z.object(Object.fromEntries(EXPENSE_FLAGS.map((f) => [f, pontos])) as Record<ExpenseFlag, typeof pontos>),
    fiscalPoints: z.object({ CANCELLED: pontos, NOT_FOUND: pontos, DIVERGENT: pontos }),
    aiPoints: z.object(Object.fromEntries(ADHERENCE_CLASSIFICATIONS.map((c) => [c, pontos])) as Record<AdherenceClassification, typeof pontos>),
    /** Sinais que, sozinhos, põem a despesa em risco alto. */
    hardFlags: z.array(expenseFlagSchema).max(EXPENSE_FLAGS.length),
    mediumFrom: z.number().int().min(1).max(99),
    highFrom: z.number().int().min(2).max(100),
  })
  .refine((p) => p.highFrom > p.mediumFrom, { message: 'O limite de risco alto precisa ser maior que o de risco médio', path: ['highFrom'] });
export type RiskPolicyRules = z.infer<typeof riskPolicyRulesSchema>;

export const riskPolicyInputSchema = z.object({
  rules: riskPolicyRulesSchema,
  /** Versão em que a edição se baseou (conflito se outra pessoa salvou antes). */
  basedOnVersion: z.number().int().min(0),
  reason: z.string().trim().min(10, 'Explique o motivo da mudança').max(1000),
});
export type RiskPolicyInput = z.infer<typeof riskPolicyInputSchema>;

export const riskPolicySchema = z.object({
  version: z.number().int(),
  /** Nome gravado em cada análise (ex.: risco-v1 para o padrão do código, politica-3). */
  label: z.string(),
  rules: riskPolicyRulesSchema,
  reason: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type RiskPolicy = z.infer<typeof riskPolicySchema>;
