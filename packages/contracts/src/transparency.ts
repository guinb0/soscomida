import { z } from 'zod';
import { budgetCategorySchema } from './campaigns';
import { centsSchema } from './common';
import { publicSupporterSchema } from './donations';

/**
 * Painel público da campanha. Cada número tem significado próprio; não existe
 * um "índice de transparência" único que esconda o que foi ou não verificado.
 */
export const campaignTransparencySchema = z.object({
  goalCents: centsSchema,
  /** Soma das doações que o provedor de pagamento confirmou. */
  confirmedCents: centsSchema,
  donationsCount: z.number().int(),
  /** Tarifas cobradas pelo provedor sobre as doações confirmadas. */
  feesCents: centsSchema,
  refundsCents: centsSchema,
  /** Confirmado − tarifas − estornos. Estimativa até a conciliação com o extrato do provedor. */
  netEstimateCents: z.number().int(),
  transferredCents: centsSchema,
  budget: z.array(
    z.object({
      category: budgetCategorySchema,
      description: z.string(),
      plannedCents: centsSchema,
    }),
  ),
  /**
   * Prestação de contas. `approvedCents`: despesas aprovadas na revisão;
   * `inReviewCents`: enviadas e ainda não decididas. Por categoria, comparado
   * ao orçamento planejado.
   */
  expenses: z.object({
    available: z.literal(true),
    approvedCents: centsSchema,
    inReviewCents: centsSchema,
    rejectedCount: z.number().int(),
    /** Aprovadas com nota autenticada no fisco. */
    fiscallyAuthenticatedCents: centsSchema,
    byCategory: z.array(z.object({ category: budgetCategorySchema, plannedCents: centsSchema, approvedCents: centsSchema, inReviewCents: centsSchema })),
  }),
  recentSupporters: z.array(publicSupporterSchema),
  generatedAt: z.string(),
});
export type CampaignTransparency = z.infer<typeof campaignTransparencySchema>;
