import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { metrics } from '../infra/observability/metrics';
import { JobRegistry } from '../infra/queue/job-registry';
import { DEAD_LETTER_QUEUE, QUEUES, type QueueName, QueueRegistry } from '../infra/queue/queue';
import { EventHandlerRegistry, OutboxService, type PublishedEvent } from '../modules/outbox';

const RELAY_INTERVAL_MS = 1_000;

/**
 * Processo de trabalho:
 * - relay do outbox (banco → fila), em loop;
 * - consumidores BullMQ: eventos de domínio e filas de jobs;
 * - tarefas periódicas registradas pelos módulos.
 *
 * O BullMQ renova o lock dos jobs em andamento; se este processo morrer, o job
 * volta para a fila quando o lock expira (stalled) — nada fica preso como
 * "processando". Falha definitiva (tentativas esgotadas) vai para a DLQ.
 */
@Injectable()
export class WorkerRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRuntime.name);
  private readonly workers: Worker[] = [];
  private relayAtivo = false;
  private relayTerminado: Promise<void> = Promise.resolve();

  constructor(
    private readonly queues: QueueRegistry,
    private readonly outbox: OutboxService,
    private readonly events: EventHandlerRegistry,
    private readonly jobs: JobRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.startConsumer(QUEUES.events, (job) => this.events.dispatch(job.data as PublishedEvent), 10);
    for (const queue of [QUEUES.payments, QUEUES.maintenance] as const) {
      this.startConsumer(queue, (job) => this.runJob(queue, job), 5);
    }
    for (const agendado of this.jobs.scheduledJobs) {
      await this.queues.get(agendado.queue).upsertJobScheduler(`${agendado.queue}:${agendado.name}`, { every: agendado.everyMs }, { name: agendado.name });
    }
    this.relayAtivo = true;
    this.relayTerminado = this.relayLoop();
    this.logger.log(`Worker no ar: ${this.workers.length} consumidores, ${this.jobs.scheduledJobs.length} tarefas periódicas`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.relayAtivo = false;
    await this.relayTerminado;
    await Promise.all(this.workers.map((w) => w.close()));
  }

  private async runJob(queue: QueueName, job: Job): Promise<unknown> {
    const handler = this.jobs.handlerFor(queue, job.name);
    if (!handler) throw new Error(`Nenhum handler para ${queue}:${job.name}`);
    return handler(job);
  }

  private startConsumer(queue: QueueName, processor: (job: Job) => Promise<unknown>, concurrency: number): void {
    const worker = new Worker(queue, processor, { connection: this.queues.connection, concurrency });
    worker.on('completed', () => metrics.jobs.inc({ queue, result: 'ok' }));
    worker.on('failed', (job, error) => {
      metrics.jobs.inc({ queue, result: 'error' });
      if (!job) return;
      const esgotou = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.warn({ queue, jobId: job.id, name: job.name, attempt: job.attemptsMade, err: error.message }, 'Job falhou');
      if (esgotou) void this.toDeadLetter(queue, job, error);
    });
    worker.on('error', (error) => this.logger.error({ queue, err: error.message }, 'Erro no consumidor'));
    this.workers.push(worker);
  }

  private async toDeadLetter(queue: string, job: Job, error: Error): Promise<void> {
    metrics.jobs.inc({ queue, result: 'dead_letter' });
    await this.queues.get(DEAD_LETTER_QUEUE).add(
      job.name,
      { queue, jobId: job.id, data: job.data as unknown, error: error.message, failedAt: new Date().toISOString() },
      { jobId: `${queue}:${job.id}`, attempts: 1, removeOnComplete: false, removeOnFail: false },
    );
    this.logger.error({ queue, jobId: job.id, name: job.name }, 'Job enviado para a dead-letter queue');
  }

  private async relayLoop(): Promise<void> {
    while (this.relayAtivo) {
      try {
        const publicados = await this.outbox.publishBatch();
        if (publicados > 0) continue;
      } catch (error) {
        this.logger.error({ err: error instanceof Error ? error.message : error }, 'Falha no relay do outbox');
      }
      await new Promise((resolve) => setTimeout(resolve, RELAY_INTERVAL_MS));
    }
  }
}
