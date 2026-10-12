import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '../..');

/**
 * Ponta a ponta contra a stack local: `pnpm dev:infra`, `pnpm build` e
 * `db:migrate` antes. A API e o site sobem aqui se não estiverem no ar; o
 * worker sobe no globalSetup (vários workers em paralelo são seguros).
 */
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node --env-file-if-exists=.env dist/main.js',
      cwd: path.join(raiz, 'apps/api'),
      // A suíte cria várias contas por minuto do mesmo IP: o limite de produção (10/min) barraria.
      env: { AUTH_RATE_LIMIT_PER_MINUTE: '1000' },
      url: 'http://127.0.0.1:4000/api/health/ready',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm start',
      cwd: path.join(raiz, 'apps/web'),
      url: 'http://localhost:3000/como-funciona',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
