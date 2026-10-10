import { z } from 'zod';
import { campaignStatusSchema } from './campaigns';

export const moderationDecisionInputSchema = z.object({
  decision: z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT']),
  reason: z.string().trim().min(10, 'Explique a decisão com pelo menos 10 caracteres').max(2000),
  version: z.number().int().nonnegative(),
});
export type ModerationDecisionInput = z.infer<typeof moderationDecisionInputSchema>;

export const moderationQueueItemSchema = z.object({
  caseId: z.uuid(),
  campaignId: z.uuid(),
  campaignTitle: z.string(),
  campaignStatus: campaignStatusSchema,
  campaignVersion: z.number().int(),
  organizerName: z.string(),
  goalCents: z.number().int(),
  openedAt: z.string(),
  assignedTo: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;
