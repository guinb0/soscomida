import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { auditEvents } from './infra/audit.schema';

export interface AuditEntry {
  actorUserId: string | null;
  /** Verbo no formato `recurso.acao` (ex.: `campaign.approved`, `auth.login_failed`). */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Contexto sem dados pessoais. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Grava na transação recebida, para a auditoria cair junto com a mudança. */
  async record(entry: AuditEntry, executor: Executor = this.db): Promise<void> {
    await executor.insert(auditEvents).values({
      id: newId(),
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    });
  }

  /** Quantas vezes uma ação aconteceu sobre um alvo desde um instante (ex.: falhas de login por e-mail). */
  async countSince(filter: { action: string; targetType: string; targetId: string }, since: Date): Promise<number> {
    const [linha] = await this.db
      .select({ total: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, filter.action),
          eq(auditEvents.targetType, filter.targetType),
          eq(auditEvents.targetId, filter.targetId),
          gt(auditEvents.occurredAt, since),
        ),
      );
    return linha?.total ?? 0;
  }
}
