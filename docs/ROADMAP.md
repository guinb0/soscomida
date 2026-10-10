# Roadmap

Cada fase só começa quando a anterior cumpre todos os critérios de aceitação.

## Fase 0 — Fundação

- [x] Diagnóstico e decisões de arquitetura (este diretório `docs/`)
- [ ] Monorepo (pnpm + Turborepo), TypeScript strict, ESLint com regras de fronteira entre módulos
- [ ] Docker Compose de desenvolvimento (Postgres, Redis, MinIO)
- [ ] API NestJS: configuração validada, logs estruturados com correlation id, health/readiness, métricas, OpenAPI
- [ ] Banco: Drizzle, migrações, triggers de imutabilidade
- [ ] Identidade: cadastro, login, logout, sessões opacas, papéis, MFA TOTP, rate limit, CSRF por origem
- [ ] Auditoria e outbox
- [ ] Worker: relay do outbox e BullMQ com retry/backoff/DLQ
- [ ] CI: lint, tipagem, testes (com Postgres e Redis), build

**Critérios:** `pnpm install && pnpm dev:infra && pnpm dev` sobe tudo do zero;
CI verde; teste de integração prova que sessão revogada perde acesso, que rota
de moderador exige MFA e que import cruzando fronteira de módulo quebra o lint.

## Fase 1 — MVP de campanhas e doações

- [ ] Campanhas: CRUD do organizador, categorias, orçamento por categoria, imagens por upload assinado, máquina de estados formal com histórico
- [ ] Moderação: fila, assumir caso, aprovar, pedir ajustes, suspender com justificativa
- [ ] Catálogo público com busca, filtros e página de campanha com SSR/ISR
- [ ] Doação Pix: intenção idempotente, cobrança no provedor, QR Code, expiração, webhook idempotente, confirmação consultando o provedor
- [ ] Ledger de dupla entrada com testes de propriedade
- [ ] Painel do doador (minhas doações) e do organizador (arrecadação)
- [ ] Transparência v1: arrecadação confirmada, tarifas, estornos, orçamento planejado
- [ ] Notificações por e-mail (doação confirmada, campanha aprovada) — log em dev

**Critérios de aceitação do MVP:**

1. Visitante encontra uma campanha ativa, doa via Pix e vê o valor entrar no
   total **somente** depois da confirmação do provedor.
2. O mesmo webhook entregue 5 vezes, fora de ordem ou depois da expiração
   resulta em exatamente uma confirmação e um conjunto de lançamentos.
3. Σ débitos = Σ créditos no ledger em todos os testes; nenhum lançamento é
   editável.
4. Organizador não consegue editar campanha de outro, nem ativar a própria
   sem aprovação; doador não acessa rotas de moderação.
5. Campanha passa por todos os estados permitidos e transições inválidas são
   recusadas com erro claro.
6. Páginas públicas renderizam no servidor e não expõem dados pessoais.
7. Com `PAYMENTS_PROVIDER=dev`, o fluxo inteiro funciona localmente; com
   `asaas` em sandbox, idem (depende de credenciais).

## Fase 2 — Prestação de contas

Despesas com estados separados, upload de documentos, leitura de XML/QR/PDF/OCR,
chave de acesso, duplicidade, `FiscalVerificationProvider` com os conectores
viáveis, rateio com limite, revisão administrativa, painel público de
despesas com selos independentes, mascaramento de dados.

## Fase 3 — IA e antifraude

`LlmProvider` (OpenAI primeiro), análise de aderência com saída validada,
proteção contra prompt injection, motor de regras com score configurável,
fila de revisão, contestação, orçamento de IA, avaliação automatizada.

## Fase 4 — Financeiro avançado

Conciliação diária com extrato, múltiplos provedores, repasses, pagamento a
fornecedor e políticas de desembolso — **só com parceiro regulado, contrato e
parecer jurídico**.

## Fase 5 — Escala

Testes de carga, cache, réplicas, separação de workers, particionamento,
operação multi-instância.

## Pendências fora do código

- Conta sandbox do Asaas (chave de API, chave Pix, token de webhook)
- Decisão sobre certificado digital para consultas à SEFAZ
- Parecer jurídico: termos de uso, privacidade, papel da plataforma, custódia
- Domínio e VPS de homologação
- App Android (Capacitor) que existia no front antigo — reavaliar depois do MVP web
