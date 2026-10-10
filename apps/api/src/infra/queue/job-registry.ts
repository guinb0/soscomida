import { Global, Injectable, Module } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { QueueName } from './queue';

export type JobHandler = (job: Job) => Promise<unknown>;

export interface ScheduledJob {
  queue: QueueName;
  name: string;
  everyMs: number;
}

/**
 * Handlers de jobs e tarefas periódicas, registrados pelos módulos no
 * `onModuleInit`. O processo worker lê este registro e cria os consumidores.
 * Na API o registro existe mas ninguém consome (a API só enfileira).
 */
@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly scheduled: ScheduledJob[] = [];

  handle(queue: QueueName, name: string, handler: JobHandler): void {
    const chave = `${queue}:${name}`;
    if (this.handlers.has(chave)) throw new Error(`Handler duplicado para ${chave}`);
    this.handlers.set(chave, handler);
  }

  schedule(job: ScheduledJob): void {
    this.scheduled.push(job);
  }

  handlerFor(queue: string, name: string): JobHandler | undefined {
    return this.handlers.get(`${queue}:${name}`);
  }

  get scheduledJobs(): readonly ScheduledJob[] {
    return this.scheduled;
  }
}

@Global()
@Module({ providers: [JobRegistry], exports: [JobRegistry] })
export class JobRegistryModule {}
