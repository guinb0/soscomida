import { CAMPAIGN_CATEGORIES, CAMPAIGN_STATUSES, BUDGET_CATEGORIES } from '@soscomida/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';
import { storedFiles } from '../../storage/infra/storage.schema';

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(', '));

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    goalCents: bigint('goal_cents', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('DRAFT'),
    region: text('region'),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    coverFileId: uuid('cover_file_id').references(() => storedFiles.id),
    /** Concorrência otimista: toda escrita confere e incrementa. */
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('campaigns_slug_key').on(t.slug),
    index('campaigns_organizer_idx').on(t.organizerId),
    index('campaigns_status_idx').on(t.status, t.publishedAt),
    check('campaigns_goal_positive', sql`${t.goalCents} > 0`),
    check('campaigns_status_check', sql`${t.status} in (${lista(CAMPAIGN_STATUSES)})`),
    check('campaigns_category_check', sql`${t.category} in (${lista(CAMPAIGN_CATEGORIES)})`),
  ],
);

export const campaignBudgetItems = pgTable(
  'campaign_budget_items',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    description: text('description').notNull(),
    plannedCents: bigint('planned_cents', { mode: 'number' }).notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    index('campaign_budget_items_campaign_idx').on(t.campaignId),
    check('campaign_budget_items_planned_positive', sql`${t.plannedCents} > 0`),
    check('campaign_budget_items_category_check', sql`${t.category} in (${lista(BUDGET_CATEGORIES)})`),
  ],
);

/** Histórico de status: só inserção (trigger na migração). */
export const campaignStatusHistory = pgTable(
  'campaign_status_history',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaign_status_history_campaign_idx').on(t.campaignId, t.occurredAt)],
);

export const campaignImages = pgTable(
  'campaign_images',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFiles.id),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('campaign_images_pk').on(t.campaignId, t.fileId)],
);

export const campaignUpdates = pgTable(
  'campaign_updates',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaign_updates_campaign_idx').on(t.campaignId, t.createdAt)],
);

/**
 * Projeção pública dos números financeiros, recalculada a partir do ledger
 * quando chega um evento de doação. Serve listagem e ordenação sem somar o
 * ledger a cada visita.
 */
export const campaignStats = pgTable('campaign_stats', {
  campaignId: uuid('campaign_id')
    .primaryKey()
    .references(() => campaigns.id),
  confirmedCents: bigint('confirmed_cents', { mode: 'number' }).notNull().default(0),
  feesCents: bigint('fees_cents', { mode: 'number' }).notNull().default(0),
  refundsCents: bigint('refunds_cents', { mode: 'number' }).notNull().default(0),
  donationsCount: integer('donations_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
