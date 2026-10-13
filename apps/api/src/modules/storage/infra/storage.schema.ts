import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';

/** Arquivos enviados. O conteúdo fica no S3; aqui só metadados e o resultado da validação. */
export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    purpose: text('purpose').notNull(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    /** Tipo declarado no pedido de upload; o tipo real é conferido na confirmação. */
    declaredMimeType: text('declared_mime_type').notNull(),
    declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }).notNull(),
    detectedMimeType: text('detected_mime_type'),
    sha256: text('sha256'),
    /** pHash (16 hex) de imagens de comprovantes: acha a mesma foto recomprimida. */
    perceptualHash: text('perceptual_hash'),
    status: text('status').notNull().default('PENDING_UPLOAD'),
    rejectionReason: text('rejection_reason'),
    publicUrl: text('public_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stored_files_object_key').on(t.bucket, t.objectKey),
    index('stored_files_owner_idx').on(t.ownerUserId),
    index('stored_files_sha256_idx').on(t.sha256),
    check('stored_files_status_check', sql`${t.status} in ('PENDING_UPLOAD', 'VALIDATED', 'REJECTED')`),
    check('stored_files_purpose_check', sql`${t.purpose} in ('campaign_image', 'expense_document')`),
    check('stored_files_size_check', sql`${t.declaredSizeBytes} > 0`),
  ],
);
