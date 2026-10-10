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
  /** Prestação de contas: disponível a partir da Fase 2. */
  expenses: z.object({
    available: z.literal(false),
  }),
  recentSupporters: z.array(publicSupporterSchema),
  generatedAt: z.string(),
});
export type CampaignTransparency = z.infer<typeof campaignTransparencySchema>;
