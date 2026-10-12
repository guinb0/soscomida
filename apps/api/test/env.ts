/**
 * Ambiente dos testes de integração. Usa a infraestrutura de `pnpm dev:infra`
 * (banco `soscomida_test` e Redis db 1), ou o que vier de TEST_DATABASE_URL /
 * TEST_REDIS_URL (CI).
 */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://soscomida:soscomida_dev@127.0.0.1:5440/soscomida_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6390/1',
  APP_ORIGINS: 'http://localhost:3000',
  // Chave fixa e pública: só para testes.
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9010',
  S3_ACCESS_KEY: 'soscomida',
  S3_SECRET_KEY: 'soscomida_dev',
  S3_FORCE_PATH_STYLE: 'true',
  S3_PRIVATE_BUCKET: 'soscomida-test-private',
  S3_PUBLIC_BUCKET: 'soscomida-test-public',
  S3_PUBLIC_BASE_URL: 'http://127.0.0.1:9010/soscomida-test-public',
  PAYMENTS_PROVIDER: 'dev',
  FISCAL_VERIFICATION_PROVIDER: 'dev',
  // Regras locais no lugar da IA: nenhum dado sai da máquina e não há custo.
  AI_PROVIDER: 'simulated',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
};
