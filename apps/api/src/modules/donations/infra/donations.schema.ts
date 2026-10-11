import { DONATION_STATUSES, MAX_DONATION_CENTS, MIN_DONATION_CENTS } from '@soscomida/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from '../../campaigns/infra/campaigns.schema';
import { users } from '../../identity/infra/identity.schema';

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(', '));

/**
 * Doações. CPF do pagador não é guardado: vai só para o provedor de
 * pagamento, que exige identificação (minimização — LGPD).
 */
export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    donorUserId: uuid('donor_user_id').references(() => users.id),
    displayName: text('display_name'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('PENDING'),
    /** Chave enviada pelo cliente: repetir a requisição devolve a mesma doação. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('donations_idempotency_key').on(t.idempotencyKey),
    index('donations_campaign_idx').on(t.campaignId, t.status, t.confirmedAt),
    index('donations_donor_idx').on(t.donorUserId),
    check('donations_status_check', sql`${t.status} in (${lista(DONATION_STATUSES)})`),
    check('donations_amount_range', sql.raw(`amount_cents between ${MIN_DONATION_CENTS} and ${MAX_DONATION_CENTS}`)),
  ],
);
