# 0005 — Centavos inteiros e ledger de dupla entrada só inserção

**Status:** aceito · 2026-10-10

## Decisão
- Valores monetários são inteiros em centavos (`bigint` no banco, `number`
  seguro no TypeScript — até R$ 90 trilhões, verificado com
  `Number.isSafeInteger`). Formatação só na borda.
- Ledger com `ledger_accounts`, `ledger_transactions` e `ledger_entries`
  (débito/crédito, valor positivo). Toda transação balanceia; o banco confere
  no commit (constraint trigger diferida) e recusa UPDATE/DELETE.
- Cada transação tem `idempotency_key` único derivado do evento de negócio.

## Consequências
Totais públicos são saldos de contas, auditáveis lançamento a lançamento.
Correções exigem lançamento compensatório com motivo. O ledger não prova
custódia (ver ADR 0009).
