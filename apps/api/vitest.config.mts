import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC no lugar do esbuild: o Nest depende de emitDecoratorMetadata, que o
// esbuild não gera.
const swcPlugin = swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'eslint/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          setupFiles: ['test/setup-env.ts'],
          // Os testes de integração compartilham o banco de teste.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
