import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from '../../campaigns/infra/campaigns.schema';
import { users } from '../../identity/infra/identity.schema';

export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('OPEN'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    decision: text('decision'),
    reason: text('reason'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    // Um caso aberto por campanha e tipo: dois moderadores não analisam a mesma coisa em paralelo.
    uniqueIndex('moderation_cases_one_open').on(t.campaignId, t.kind).where(sql`${t.status} = 'OPEN'`),
    index('moderation_cases_assigned_idx').on(t.assignedTo),
    check('moderation_cases_kind_check', sql`${t.kind} in ('CAMPAIGN_REVIEW', 'INVESTIGATION')`),
    check('moderation_cases_status_check', sql`${t.status} in ('OPEN', 'CLOSED')`),
  ],
);
