import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';

/**
 * Registro de e-mails enviados. A `dedupe_key` (evento + modelo) garante um
 * e-mail por acontecimento mesmo com o evento entregue várias vezes. O
 * endereço não é copiado aqui: sai do cadastro na hora do envio.
 */
export const emailNotifications = pgTable(
  'email_notifications',
  {
    id: uuid('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    template: text('template').notNull(),
    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('email_notifications_dedupe_key').on(t.dedupeKey),
    index('email_notifications_user_idx').on(t.userId, t.createdAt),
    check('email_notifications_status_check', sql`${t.status} in ('PENDING', 'SENT', 'SKIPPED')`),
  ],
);
