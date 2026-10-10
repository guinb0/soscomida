# 0006 — Outbox transacional + BullMQ

**Status:** aceito · 2026-10-10

## Contexto
Publicar um evento na fila depois de commitar o banco perde eventos se o
processo cair entre as duas operações; publicar antes gera eventos de
transações que deram rollback.

## Decisão
O caso de uso grava o evento em `outbox_events` na mesma transação da mudança.
Um relay no worker lê lotes com `FOR UPDATE SKIP LOCKED`, enfileira no BullMQ
com `jobId = id do evento` (o BullMQ ignora job com id repetido) e marca como
publicado. Consumidores são idempotentes.

BullMQ fornece retries com backoff exponencial, lock com renovação (job de
worker morto volta para a fila — nenhum job fica preso em "processando") e
fila de falhas definitivas (DLQ), reprocessável pela administração.

## Consequências
Entrega pelo menos uma vez, nunca "exatamente uma". Redis passa a ser
dependência obrigatória e precisa de AOF ligado.
