# 0007 — Worker como segundo entrypoint de `apps/api`

**Status:** aceito · 2026-10-10

## Contexto
O briefing sugere `apps/worker`. O worker precisa das mesmas regras de
domínio da API (ledger, transições de pagamento, projeções).

## Decisão
`apps/api` gera dois processos a partir do mesmo build: `dist/main.js` (HTTP)
e `dist/worker.js` (relay do outbox + consumidores BullMQ). Em produção são dois
containers da mesma imagem com comandos diferentes.

## Alternativa descartada
Pacote `apps/worker` separado exigiria mover todo o domínio para
`packages/*`, criando um pacote compartilhado gigante com risco de
dependências circulares — o oposto do que o briefing pede.

## Consequências
Escala independente (mais réplicas de worker sem mais API) sem duplicar
código. Se um dia o processamento de documentos virar serviço próprio, o
módulo já está isolado atrás da fachada.
