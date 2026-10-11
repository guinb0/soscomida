import { ASSESSMENTS, EXPENSE_DOCUMENT_KINDS, EXPENSE_STATUSES, type ExpenseFlag } from '@soscomida/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaigns } from '../../campaigns/infra/campaigns.schema';
import { fiscalDocuments } from '../../fiscal/infra/fiscal.schema';
import { users } from '../../identity/infra/identity.schema';
import { storedFiles } from '../../storage/infra/storage.schema';

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(', '));

/**
 * Despesa da prestação de contas. O dinheiro não passa pela plataforma: a
 * despesa registra e comprova um gasto feito pela organização, por isso não
 * gera lançamento no ledger.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    budgetCategory: text('budget_category').notNull(),
    description: text('description').notNull(),
    supplierName: text('supplier_name').notNull(),
    /** Só dígitos. CPF de fornecedor pessoa física nunca é exibido sem máscara. */
    supplierDocument: text('supplier_document'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    paymentProof: text('payment_proof').notNull().default('NONE'),
    delivery: text('delivery').notNull().default('NONE'),
    /** Alertas automáticos calculados no envio para revisão. */
    flags: jsonb('flags').$type<ExpenseFlag[]>().notNull().default([]),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('expenses_campaign_idx').on(t.campaignId, t.status),
    index('expenses_queue_idx').on(t.status, t.submittedAt),
    check('expenses_status_check', sql`${t.status} in (${lista(EXPENSE_STATUSES)})`),
    check('expenses_amount_positive', sql`${t.amountCents} > 0`),
    check('expenses_payment_proof_check', sql`${t.paymentProof} in (${lista(ASSESSMENTS)})`),
    check('expenses_delivery_check', sql`${t.delivery} in (${lista(ASSESSMENTS)})`),
  ],
);

export const EXTRACTION_STATUSES = ['EXTRACTED', 'NEEDS_ACCESS_KEY', 'NEEDS_TOTAL', 'NOT_APPLICABLE'] as const;

/**
 * Arquivo anexado a uma despesa. Notas fiscais apontam para o documento
 * fiscal (único pela chave) com a parte do valor atribuída a esta despesa.
 * Σ allocated_cents por nota ≤ total da nota (trigger na migração 0003).
 */
export const expenseDocuments = pgTable(
  'expense_documents',
  {
    id: uuid('id').primaryKey(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFiles.id),
    kind: text('kind').notNull(),
    fiscalDocumentId: uuid('fiscal_document_id').references(() => fiscalDocuments.id),
    allocatedCents: bigint('allocated_cents', { mode: 'number' }),
    sharingJustification: text('sharing_justification'),
    extractionStatus: text('extraction_status').notNull(),
    extractionMessage: text('extraction_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('expense_documents_file').on(t.fileId),
    uniqueIndex('expense_documents_fiscal_once').on(t.expenseId, t.fiscalDocumentId).where(sql`${t.fiscalDocumentId} is not null`),
    index('expense_documents_fiscal_idx').on(t.fiscalDocumentId),
    check('expense_documents_kind_check', sql`${t.kind} in (${lista(EXPENSE_DOCUMENT_KINDS)})`),
    check('expense_documents_extraction_check', sql`${t.extractionStatus} in (${lista(EXTRACTION_STATUSES)})`),
    check('expense_documents_allocation_positive', sql`${t.allocatedCents} is null or ${t.allocatedCents} > 0`),
    check('expense_documents_fiscal_kind', sql`${t.fiscalDocumentId} is null or ${t.kind} = 'FISCAL'`),
    check('expense_documents_allocated_needs_fiscal', sql`${t.allocatedCents} is null or ${t.fiscalDocumentId} is not null`),
  ],
);

/** Histórico de status. Só inserção. */
export const expenseStatusHistory = pgTable(
  'expense_status_history',
  {
    id: uuid('id').primaryKey(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('expense_status_history_expense_idx').on(t.expenseId, t.occurredAt)],
);
