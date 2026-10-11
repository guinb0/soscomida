import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey(),
    /** Ex.: `campaign:<id>:donations`, `provider:asaas:receivable`. */
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    campaignId: uuid('campaign_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_code_key').on(t.code),
    index('ledger_accounts_campaign_idx').on(t.campaignId),
    check('ledger_accounts_kind_check', sql`${t.kind} in ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE')`),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    /** Derivada do evento de negócio (ex.: `donation:<id>:confirmed`): impede lançamento duplo. */
    idempotencyKey: text('idempotency_key').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    campaignId: uuid('campaign_id'),
    description: text('description').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_transactions_idempotency_key').on(t.idempotencyKey),
    index('ledger_transactions_campaign_idx').on(t.campaignId, t.kind),
    index('ledger_transactions_reference_idx').on(t.referenceType, t.referenceId),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: text('direction').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('ledger_entries_transaction_idx').on(t.transactionId),
    index('ledger_entries_account_idx').on(t.accountId),
    check('ledger_entries_direction_check', sql`${t.direction} in ('DEBIT', 'CREDIT')`),
    check('ledger_entries_amount_positive', sql`${t.amountCents} > 0`),
  ],
);
