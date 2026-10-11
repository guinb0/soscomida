import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { INTENT_STATUSES } from '../domain/intent-status';

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(', '));

/**
 * Uma cobrança junto ao provedor. Genérica: aponta para o que está sendo
 * pago por `reference_type`/`reference_id` (hoje só doações).
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey(),
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    method: text('method').notNull().default('PIX'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }),
    netCents: bigint('net_cents', { mode: 'number' }),
    status: text('status').notNull().default('CREATED'),
    pixCopyPaste: text('pix_copy_paste'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_intents_reference_key').on(t.referenceType, t.referenceId),
    uniqueIndex('payment_intents_provider_payment_key').on(t.provider, t.providerPaymentId),
    index('payment_intents_status_idx').on(t.status, t.createdAt),
    check('payment_intents_status_check', sql`${t.status} in (${lista(INTENT_STATUSES)})`),
    check('payment_intents_amount_positive', sql`${t.amountCents} > 0`),
    check('payment_intents_fee_range', sql`${t.feeCents} is null or (${t.feeCents} >= 0 and ${t.feeCents} <= ${t.amountCents})`),
  ],
);

/**
 * Eventos recebidos dos provedores (webhooks). O UNIQUE por id do evento é a
 * base da idempotência: o mesmo webhook entregue 10 vezes vira uma linha.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    providerPaymentId: text('provider_payment_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('RECEIVED'),
    attempts: integer('attempts').notNull().default(0),
    result: text('result'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payment_events_provider_event_key').on(t.provider, t.providerEventId),
    index('payment_events_payment_idx').on(t.provider, t.providerPaymentId),
    check('payment_events_status_check', sql`${t.status} in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')`),
  ],
);
