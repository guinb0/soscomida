import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Trilha de auditoria. Só inserção: a migração cria um trigger que recusa
 * UPDATE e DELETE. `metadata` nunca leva dados pessoais (CPF, senha, documento).
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    requestId: text('request_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_target_idx').on(t.targetType, t.targetId),
    index('audit_events_actor_idx').on(t.actorUserId),
    index('audit_events_occurred_at_idx').on(t.occurredAt),
  ],
);
