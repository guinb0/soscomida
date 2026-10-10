import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { metrics } from '../../infra/observability/metrics';
import { DEFAULT_JOB_OPTIONS, QUEUES, QueueRegistry } from '../../infra/queue/queue';
import { outboxEvents } from './infra/outbox.schema';

export interface DomainEvent<TType extends string = string, TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: TType;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
}

/** Mensagem que chega aos consumidores (id = id do evento no outbox). */
export interface PublishedEvent extends DomainEvent {
  id: string;
  occurredAt: string;
}

const LEASE_SECONDS = 30;
const MAX_ATTEMPTS = 20;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queues: QueueRegistry,
  ) {}

  /** Grava o evento na transação do chamador. Sem transação, o evento poderia sair de uma mudança que deu rollback. */
  async add(executor: Executor, event: DomainEvent): Promise<string> {
    const id = newId();
    await executor.insert(outboxEvents).values({
      id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    });
    return id;
  }

  /**
   * Publica um lote de eventos pendentes. Seguro com vários relays em paralelo:
   * `FOR UPDATE SKIP LOCKED` + lease evitam que dois peguem o mesmo evento, e o
   * `jobId` = id do evento faz o BullMQ descartar uma publicação repetida
   * (caso o relay caia entre enfileirar e marcar como publicado).
   */
  async publishBatch(limit = 100): Promise<number> {
    const lote = await this.db.transaction(async (tx) => {
      const agora = new Date();
      const pendentes = await tx
        .select()
        .from(outboxEvents)
        .where(
          and(
            isNull(outboxEvents.publishedAt),
            lte(outboxEvents.availableAt, agora),
            or(isNull(outboxEvents.lockedUntil), lte(outboxEvents.lockedUntil, agora)),
            sql`${outboxEvents.attempts} < ${MAX_ATTEMPTS}`,
          ),
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });

      if (pendentes.length === 0) return [];
      const lease = new Date(agora.getTime() + LEASE_SECONDS * 1000);
      await tx
        .update(outboxEvents)
        .set({ lockedUntil: lease, attempts: sql`${outboxEvents.attempts} + 1` })
        .where(inArray(outboxEvents.id, pendentes.map((p) => p.id)));
      return pendentes;
    });

    const queue = this.queues.get(QUEUES.events);
    for (const evento of lote) {
      const mensagem: PublishedEvent = {
        id: evento.id,
        type: evento.type,
        aggregateType: evento.aggregateType,
        aggregateId: evento.aggregateId,
        payload: evento.payload,
        occurredAt: evento.createdAt.toISOString(),
      };
      try {
        await queue.add(evento.type, mensagem, { ...DEFAULT_JOB_OPTIONS, jobId: evento.id });
        await this.db.update(outboxEvents).set({ publishedAt: new Date(), lockedUntil: null, lastError: null }).where(eq(outboxEvents.id, evento.id));
        metrics.outboxPublished.inc({ type: evento.type });
      } catch (error) {
        // O lease expira e outro ciclo tenta de novo.
        const mensagemErro = error instanceof Error ? error.message : String(error);
        this.logger.warn({ eventId: evento.id, err: mensagemErro }, 'Falha ao publicar evento do outbox');
        await this.db.update(outboxEvents).set({ lastError: mensagemErro.slice(0, 1000) }).where(eq(outboxEvents.id, evento.id));
      }
    }
    return lote.length;
  }
}
