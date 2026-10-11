import { z } from 'zod';
import { centsSchema, paginated, paginationQuerySchema } from './common';

export const CAMPAIGN_CATEGORIES = [
  'SAUDE',
  'ALIMENTACAO',
  'ANIMAIS',
  'EDUCACAO',
  'EMERGENCIAS',
  'PROJETOS_SOCIAIS',
  'HABITACAO',
  'OUTRAS',
] as const;
export const campaignCategorySchema = z.enum(CAMPAIGN_CATEGORIES);
export type CampaignCategory = z.infer<typeof campaignCategorySchema>;

export const CATEGORY_LABELS: Record<CampaignCategory, string> = {
  SAUDE: 'Saúde',
  ALIMENTACAO: 'Alimentação',
  ANIMAIS: 'Animais',
  EDUCACAO: 'Educação',
  EMERGENCIAS: 'Emergências',
  PROJETOS_SOCIAIS: 'Projetos sociais',
  HABITACAO: 'Habitação',
  OUTRAS: 'Outras',
};

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'IN_REVIEW',
  'APPROVED',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'CANCELLED',
  'UNDER_INVESTIGATION',
] as const;
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING_REVIEW: 'Aguardando verificação',
  IN_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ENDED: 'Encerrada',
  CANCELLED: 'Cancelada',
  UNDER_INVESTIGATION: 'Sob investigação',
};

/** Categorias de despesa do orçamento planejado. */
export const BUDGET_CATEGORIES = [
  'ALIMENTOS',
  'MEDICAMENTOS',
  'SERVICOS_SAUDE',
  'VETERINARIO',
  'TRANSPORTE',
  'EMBALAGENS',
  'MATERIAIS',
  'SERVICOS',
  'MORADIA',
  'EDUCACAO',
  'OUTROS',
] as const;
export const budgetCategorySchema = z.enum(BUDGET_CATEGORIES);
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;

export const BUDGET_LABELS: Record<BudgetCategory, string> = {
  ALIMENTOS: 'Alimentos',
  MEDICAMENTOS: 'Medicamentos',
  SERVICOS_SAUDE: 'Serviços de saúde',
  VETERINARIO: 'Veterinário',
  TRANSPORTE: 'Transporte',
  EMBALAGENS: 'Embalagens',
  MATERIAIS: 'Materiais',
  SERVICOS: 'Serviços',
  MORADIA: 'Moradia',
  EDUCACAO: 'Educação',
  OUTROS: 'Outros',
};

export const budgetItemInputSchema = z.object({
  category: budgetCategorySchema,
  description: z.string().trim().min(3).max(200),
  plannedCents: centsSchema.positive(),
});
export type BudgetItemInput = z.infer<typeof budgetItemInputSchema>;

const campaignFieldsSchema = z.object({
  title: z.string().trim().min(10, 'Título muito curto').max(120),
  summary: z.string().trim().min(20).max(280),
  description: z.string().trim().min(100, 'Descreva a causa com pelo menos 100 caracteres').max(20_000),
  category: campaignCategorySchema,
  goalCents: centsSchema.min(10_000, 'Meta mínima de R$ 100').max(100_000_000_00),
  region: z.string().trim().max(120).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }),
  budget: z.array(budgetItemInputSchema).min(1, 'Inclua ao menos um item no orçamento').max(30),
});

export const createCampaignInputSchema = campaignFieldsSchema;
export type CreateCampaignInput = z.infer<typeof createCampaignInputSchema>;

export const updateCampaignInputSchema = campaignFieldsSchema.partial().extend({
  /** Concorrência otimista: a versão que o cliente leu. */
  version: z.number().int().nonnegative(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignInputSchema>;

export const budgetItemSchema = budgetItemInputSchema.extend({ id: z.uuid() });

export const campaignCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: campaignCategorySchema,
  status: campaignStatusSchema,
  goalCents: centsSchema,
  confirmedCents: centsSchema,
  donationsCount: z.number().int(),
  region: z.string().nullable(),
  coverUrl: z.string().nullable(),
  endsAt: z.string(),
});
export type CampaignCard = z.infer<typeof campaignCardSchema>;

export const campaignDetailSchema = campaignCardSchema.extend({
  description: z.string(),
  organizer: z.object({ id: z.uuid(), name: z.string() }),
  budget: z.array(budgetItemSchema),
  imageUrls: z.array(z.string()),
  publishedAt: z.string().nullable(),
  acceptsDonations: z.boolean(),
});
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

/** Visão do organizador: inclui rascunho, versão e retorno da moderação. */
export const ownedCampaignSchema = campaignDetailSchema.extend({
  version: z.number().int(),
  images: z.array(z.object({ fileId: z.uuid(), url: z.string() })),
  moderationNote: z.string().nullable(),
  allowedActions: z.array(z.string()),
});
export type OwnedCampaign = z.infer<typeof ownedCampaignSchema>;

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  category: campaignCategorySchema.optional(),
  region: z.string().trim().max(120).optional(),
  sort: z.enum(['recentes', 'mais_arrecadadas', 'terminando']).default('recentes'),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const campaignListSchema = paginated(campaignCardSchema);
export type CampaignList = z.infer<typeof campaignListSchema>;

export const statusChangeInputSchema = z.object({
  reason: z.string().trim().min(10, 'Explique o motivo com pelo menos 10 caracteres').max(2000),
  version: z.number().int().nonnegative(),
});
export type StatusChangeInput = z.infer<typeof statusChangeInputSchema>;

export const campaignUpdateInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(5000),
});

export const imageUploadRequestSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(8 * 1024 * 1024, 'Imagem de até 8 MB'),
});
export type ImageUploadRequest = z.infer<typeof imageUploadRequestSchema>;

export const imageUploadTicketSchema = z.object({
  fileId: z.uuid(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type ImageUploadTicket = z.infer<typeof imageUploadTicketSchema>;
