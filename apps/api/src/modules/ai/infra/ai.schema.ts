import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Cada chamada a um provedor de IA: modelo, versão do prompt, tokens, custo
 * estimado e latência. Base do orçamento mensal e da auditoria. Só inserção.
 * Não guarda o conteúdo enviado (fica o hash na análise que pediu a chamada).
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey(),
    purpose: text('purpose').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Milésimos de centavo de real (inteiro). */
    costMillicents: bigint('cost_millicents', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_calls_created_idx').on(t.createdAt),
    index('ai_calls_subject_idx').on(t.subjectType, t.subjectId),
    check('ai_calls_status_check', sql`${t.status} in ('OK', 'INVALID_OUTPUT', 'ERROR')`),
    check('ai_calls_cost_check', sql`${t.costMillicents} >= 0`),
  ],
);
