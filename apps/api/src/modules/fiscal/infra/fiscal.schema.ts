import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';
import type { SignatureDetails } from '../domain/xml-signature';
import { storedFiles } from '../../storage/infra/storage.schema';

/**
 * Documento fiscal (NF-e/NFC-e) identificado pela chave de acesso. Uma chave
 * existe uma única vez na plataforma: duas despesas que usem a mesma nota
 * compartilham este registro e disputam o mesmo total (rateio com limite).
 */
export const fiscalDocuments = pgTable(
  'fiscal_documents',
  {
    id: uuid('id').primaryKey(),
    accessKey: text('access_key').notNull(),
    model: text('model').notNull(),
    uf: text('uf').notNull(),
    series: integer('series').notNull(),
    number: bigint('number', { mode: 'number' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    /** 1 = produção; 2 = homologação (sem valor fiscal). */
    environment: smallint('environment'),
    issuerDocument: text('issuer_document').notNull(),
    issuerName: text('issuer_name'),
    /** Total lido do próprio documento (XML ou QR offline). */
    totalCents: bigint('total_cents', { mode: 'number' }),
    /** Total informado por quem enviou, quando o documento não o traz. */
    declaredTotalCents: bigint('declared_total_cents', { mode: 'number' }),
    /** De onde vieram os dados: XML > QR_CODE > ACCESS_KEY (digitada). */
    source: text('source').notNull(),
    sourceFileId: uuid('source_file_id').references(() => storedFiles.id),
    /** Protocolo DECLARADO no XML (cStat). Não é verificação. */
    protocolStatus: integer('protocol_status'),
    protocolNumber: text('protocol_number'),
    protocolMessage: text('protocol_message'),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    /** Assinatura XMLDSig do emitente (só para XML): VALID, MISSING ou INVALID. */
    signatureStatus: text('signature_status'),
    /** Certificado e problemas encontrados; ver fiscal/domain/xml-signature.ts. */
    signatureDetails: jsonb('signature_details').$type<SignatureDetails>(),
    /** Projeção da última tentativa em fiscal_verifications. */
    verificationStatus: text('verification_status').notNull().default('NOT_VERIFIED'),
    verificationReason: text('verification_reason'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_documents_access_key').on(t.accessKey),
    index('fiscal_documents_issuer_idx').on(t.issuerDocument),
    check('fiscal_documents_key_format', sql`${t.accessKey} ~ '^[0-9]{44}$'`),
    check('fiscal_documents_model_check', sql`${t.model} in ('NFE_55', 'NFCE_65')`),
    check('fiscal_documents_source_check', sql`${t.source} in ('XML', 'QR_CODE', 'ACCESS_KEY')`),
    check('fiscal_documents_signature_check', sql`${t.signatureStatus} is null or ${t.signatureStatus} in ('VALID', 'MISSING', 'INVALID')`),
    check('fiscal_documents_total_check', sql`${t.totalCents} is null or ${t.totalCents} >= 0`),
    check('fiscal_documents_declared_check', sql`${t.declaredTotalCents} is null or ${t.declaredTotalCents} > 0`),
    check(
      'fiscal_documents_verification_check',
      sql`${t.verificationStatus} in ('NOT_VERIFIED', 'AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT', 'UNVERIFIABLE')`,
    ),
  ],
);

export const fiscalDocumentItems = pgTable(
  'fiscal_document_items',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fiscalDocuments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    ncm: text('ncm'),
    cfop: text('cfop'),
    unit: text('unit'),
    quantity: text('quantity'),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('fiscal_document_items_position').on(t.documentId, t.position)],
);

/** Cada tentativa de verificação, com o provedor e a evidência. Só inserção. */
export const fiscalVerifications = pgTable(
  'fiscal_verifications',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fiscalDocuments.id),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    details: text('details'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('fiscal_verifications_document_idx').on(t.documentId, t.createdAt),
    check('fiscal_verifications_status_check', sql`${t.status} in ('AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT', 'UNVERIFIABLE')`),
  ],
);
