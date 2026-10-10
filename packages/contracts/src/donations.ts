import { isValidCpf, onlyDigits } from '@soscomida/shared';
import { z } from 'zod';
import { centsSchema } from './common';

export const DONATION_STATUSES = ['PENDING', 'CONFIRMED', 'EXPIRED', 'FAILED', 'REFUNDED'] as const;
export const donationStatusSchema = z.enum(DONATION_STATUSES);
export type DonationStatus = z.infer<typeof donationStatusSchema>;

export const DONATION_STATUS_LABELS: Record<DonationStatus, string> = {
  PENDING: 'Aguardando pagamento',
  CONFIRMED: 'Confirmada',
  EXPIRED: 'Expirada',
  FAILED: 'Falhou',
  REFUNDED: 'Estornada',
};

export const MIN_DONATION_CENTS = 500;
export const MAX_DONATION_CENTS = 5_000_000;

export const createDonationInputSchema = z.object({
  campaignId: z.uuid(),
  amountCents: centsSchema
    .min(MIN_DONATION_CENTS, 'Doação mínima de R$ 5,00')
    .max(MAX_DONATION_CENTS, 'Doação máxima de R$ 50.000,00 por transação'),
  /** Nome exibido na lista pública de apoiadores; ignorado se `anonymous`. */
  displayName: z.string().trim().max(60).optional(),
  anonymous: z.boolean().default(false),
  /** O provedor Pix exige identificação do pagador. Não é publicado. */
  payer: z.object({
    name: z.string().trim().min(3).max(120),
    cpf: z
      .string()
      .transform(onlyDigits)
      .refine(isValidCpf, 'CPF inválido'),
    email: z.email().optional(),
  }),
});
export type CreateDonationInput = z.input<typeof createDonationInputSchema>;

export const donationCheckoutSchema = z.object({
  donationId: z.uuid(),
  status: donationStatusSchema,
  amountCents: centsSchema,
  pix: z
    .object({
      copyPaste: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  /** Presente só com o provedor de desenvolvimento: o QR não é pagável. */
  developmentOnly: z.boolean(),
});
export type DonationCheckout = z.infer<typeof donationCheckoutSchema>;

export const myDonationSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  campaignTitle: z.string(),
  campaignSlug: z.string(),
  amountCents: centsSchema,
  status: donationStatusSchema,
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type MyDonation = z.infer<typeof myDonationSchema>;

export const publicSupporterSchema = z.object({
  displayName: z.string(),
  amountCents: centsSchema,
  confirmedAt: z.string(),
});
export type PublicSupporter = z.infer<typeof publicSupporterSchema>;
