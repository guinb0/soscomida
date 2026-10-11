# SOS Comida

Plataforma brasileira de doações com **prestação de contas verificável**:
campanhas, doações via Pix e, nas próximas fases, despesas comprovadas por
nota fiscal, verificação fiscal automática quando possível, análise de
aderência por IA e motor antifraude — sempre mostrando ao doador o nível real
de verificação de cada número.

> Estado: **Fases 0 e 1** (fundação + campanhas e doações). Ver
> [ROADMAP](docs/ROADMAP.md).

## Estrutura

```
apps/api        NestJS — API HTTP (dist/main.js) e worker (dist/worker.js)
apps/web        Next.js — site público e painéis
packages/       contracts (Zod), shared (dinheiro, CPF/CNPJ, chave fiscal), config
infra/          Docker Compose (dev e produção), scripts de backup
docs/           arquitetura, banco, segurança, pagamentos, ADRs
```

Leia primeiro [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rodar localmente

Requisitos: Node 24 (ver `.nvmrc`), pnpm 10, Docker.

```bash
pnpm install
pnpm dev:infra                               # Postgres :5440, Redis :6390, S3 :9010
cp apps/api/.env.example apps/api/.env       # e preencha MFA_ENCRYPTION_KEY (comando no arquivo)
cp apps/web/.env.example apps/web/.env
pnpm build
pnpm --filter @soscomida/api db:migrate
pnpm dev                                     # web :3000, API :4000, worker
```

- Site: http://localhost:3000
- API e OpenAPI: http://localhost:4000/api/docs
- Primeiro administrador: crie a conta pelo site e rode
  `pnpm --filter @soscomida/api grant-role voce@exemplo.com admin`.
  No primeiro acesso à área administrativa o MFA (TOTP) é exigido.

Em desenvolvimento os pagamentos usam o **provedor de desenvolvimento**: o QR
Code gerado **não é pagável** e a confirmação é simulada pela tela de
doação (só em `development`). Integração real: [docs/PAYMENTS.md](docs/PAYMENTS.md).

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm build` | compila tudo (Turborepo, com cache) |
| `pnpm lint` | ESLint, incluindo a regra de fronteira entre módulos |
| `pnpm typecheck` | TypeScript strict |
| `pnpm test` | testes unitários e de integração (precisa de `pnpm dev:infra`) |
| `pnpm --filter @soscomida/api db:generate` | gera migração a partir dos schemas |
| `pnpm --filter @soscomida/api db:migrate` | aplica migrações |

## Documentação

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | diagnóstico, módulos, fluxos, decisões |
| [DATABASE](docs/DATABASE.md) | modelo, invariantes, retenção |
| [PAYMENTS](docs/PAYMENTS.md) | Pix, webhooks, ledger, conciliação |
| [FISCAL_VALIDATION](docs/FISCAL_VALIDATION.md) | validação de notas (Fase 2) |
| [AI_PIPELINE](docs/AI_PIPELINE.md) | IA de aderência e antifraude (Fase 3) |
| [SECURITY](docs/SECURITY.md) | ameaças, LGPD, riscos regulatórios |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | ambientes, deploy, backup, custos por estágio |
| [TESTING](docs/TESTING.md) | estratégia e como rodar os testes |
| [ROADMAP](docs/ROADMAP.md) | fases e critérios de aceitação |
| [decisions/](docs/decisions) | ADRs |
