import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config';

export type Database = NodePgDatabase;
/** Banco ou transação: casos de uso recebem um destes para compor operações atômicas. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max, idleTimeoutMillis: 30_000, application_name: 'soscomida' });
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Erro de violação de constraint UNIQUE do Postgres. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = findPgError(error);
  return pgError?.code === '23505' && (constraint === undefined || pgError.constraint === constraint);
}

function findPgError(error: unknown): { code?: string; constraint?: string } | undefined {
  let atual: unknown = error;
  for (let i = 0; i < 5 && atual; i++) {
    if (typeof atual === 'object' && atual !== null && 'code' in atual) return atual as { code?: string; constraint?: string };
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}
