import { baseConfig } from '@soscomida/config/eslint';

export default [{ ignores: ['playwright-report/**', 'test-results/**'] }, ...baseConfig({ tsconfigRootDir: import.meta.dirname })];
