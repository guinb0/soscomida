import { baseConfig } from '@soscomida/config/eslint';
import { moduleBoundaries } from './eslint/module-boundaries.mjs';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    plugins: { soscomida: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'soscomida/module-boundaries': 'error' },
  },
  {
    // Decorators do Nest e o pg/drizzle produzem muito `any` legítimo em tipos de biblioteca.
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
