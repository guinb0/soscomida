# Testes

## Camadas

| Camada | Onde | Ferramenta | Depende de |
|---|---|---|---|
| Unitário e propriedades | `packages/*/src/**/*.test.ts`, `apps/api/src/**/*.test.ts` | Vitest + fast-check | nada |
| Regras de lint próprias | `apps/api/eslint/*.test.ts` | RuleTester do ESLint | nada |
| Integração (API real) | `apps/api/test/**/*.int.test.ts` | Vitest + supertest | Postgres e Redis |
| Ponta a ponta | `tests/e2e/specs` | Playwright (Chromium desktop e celular) | stack completa + Mailpit |

Os testes de integração sobem o `AppModule` inteiro (guards, filtros,
validação) e falam HTTP com ele. Nada de banco em memória: dinheiro e
concorrência só se testam no Postgres de verdade.

## Rodar

```bash
pnpm dev:infra          # Postgres e Redis locais
pnpm test               # tudo
pnpm --filter @soscomida/api test:unit
pnpm --filter @soscomida/api test:integration

# ponta a ponta: precisa de build, migração e .env (README). Sobe API e site
# se não estiverem no ar, e um worker próprio.
pnpm --filter @soscomida/e2e exec playwright install chromium   # uma vez
pnpm test:e2e
```

O e2e percorre o fluxo real no navegador: cadastro, criação de campanha,
moderação com MFA (TOTP de verdade), publicação, doação Pix simulada, valor na
página pública sem dados pessoais e o e-mail de aprovação no Mailpit.

O `globalSetup` **apaga e recria** o schema do banco `soscomida_test` e limpa
o Redis db 1 a cada execução. Tabelas só-inserção (auditoria, ledger) recusam
`TRUNCATE`, então os testes não limpam dados entre si: cada teste cria
usuários e campanhas com identificadores únicos.

No CI, `TEST_DATABASE_URL` e `TEST_REDIS_URL` apontam para os serviços do
GitHub Actions.

## O que é obrigatório cobrir

Toda mudança em dinheiro, permissão ou estado precisa de teste de integração.
Em particular:

- **Pagamentos:** confirmação, expiração, webhook duplicado, atrasado, fora de
  ordem, forjado, estorno, retry após falha parcial.
- **Ledger:** propriedade Σ débitos = Σ créditos para qualquer sequência de
  eventos; imutabilidade no banco.
- **Permissões:** troca de identificadores (IDOR), escalada de privilégio,
  MFA para papéis elevados.
- **Concorrência:** duas confirmações simultâneas da mesma cobrança, edição
  concorrente (versão otimista), dois relays do outbox.

A lista completa por fase está em [ROADMAP.md](ROADMAP.md) e no briefing do
projeto.
