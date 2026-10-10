import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './db';

/** Pasta das migrações SQL, tanto em `src/` (testes) quanto em `dist/` (produção). */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', '..', 'drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 1);
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.warn('Migrações aplicadas.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
