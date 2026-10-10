import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, type JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Nomes das filas. Uma fila por tipo de trabalho permite escalar e pausar
 * cada um separadamente (ex.: só os workers de documentos na Fase 2).
 */
export const QUEUES = {
  /** Eventos de domínio publicados pelo relay do outbox. */
  events: 'domain-events',
  /** Webhooks de pagamento a processar. */
  payments: 'payments',
  /** Tarefas periódicas (expiração de cobranças, conciliação). */
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Fila de falhas definitivas, para análise e reprocessamento manual. */
export const DEAD_LETTER_QUEUE = 'dead-letter';

/** Retry com backoff exponencial: 2s, 4s, 8s, 16s, 32s. Depois disso, DLQ. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Exigido pelo BullMQ para workers: comandos bloqueantes não podem ter retry limitado.
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class QueueRegistry implements OnApplicationShutdown {
  private readonly queues = new Map<string, Queue>();
  readonly connection: ConnectionOptions;
  private healthClient?: IORedis;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.connection = redisConnection(config.REDIS_URL);
  }

  /** Conexão leve só para o health check (não interfere nas conexões das filas). */
  async ping(): Promise<void> {
    this.healthClient ??= new IORedis(this.config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    if (this.healthClient.status === 'wait') await this.healthClient.connect();
    await this.healthClient.ping();
  }

  get(name: QueueName | typeof DEAD_LETTER_QUEUE): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.healthClient?.disconnect();
  }
}

@Global()
@Module({ providers: [QueueRegistry], exports: [QueueRegistry] })
export class QueueModule {}
