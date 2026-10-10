import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Regras comuns a todos os pacotes TypeScript do monorepo. */
export function baseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', '.next/**', 'drizzle/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-floating-promises': 'error',
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    {
      files: ['**/*.mjs', '**/*.js', '**/vitest.config.*', '**/drizzle.config.*'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ['**/*.test.ts', '**/test/**/*.ts'],
      rules: {
        // supertest e o Nest devolvem `any` em getHttpServer()/body.
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  );
}
