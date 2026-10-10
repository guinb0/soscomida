import IORedis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../src/infra/db/migrate';
import { TEST_ENV } from './env';

/** Recria o banco de teste do zero e limpa o Redis de teste antes da suíte. */
export default async function globalSetup(): Promise<void> {
  const url = TEST_ENV.DATABASE_URL!;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  } finally {
    await client.end();
  }
  await runMigrations(url);

  const redis = new IORedis(TEST_ENV.REDIS_URL!, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  redis.disconnect();
}
