import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Eventos de domínio gravados na mesma transação da mudança que os gerou.
 * O relay do worker publica na fila e marca `published_at`.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    /** Lease do relay: outro processo só pega o evento depois desse horário. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.availableAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);
