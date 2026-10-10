import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/modules/*/infra/*.schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://soscomida:soscomida_dev@127.0.0.1:5440/soscomida',
  },
  strict: true,
  verbose: true,
});
