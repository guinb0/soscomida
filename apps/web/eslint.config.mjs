import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  {
    // Versão explícita: a detecção automática do eslint-plugin-react 7.x chama
    // uma API removida no ESLint 10.
    settings: { react: { version: '19.2' } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
];

export default config;
