# 0002 — NestJS como monólito modular

**Status:** aceito · 2026-10-10

## Contexto
O backend anterior era .NET. O sistema-alvo é quase todo novo (ledger, Pix,
validação fiscal, IA, outbox). O dono do produto escolheu migrar para
TypeScript para compartilhar contratos com o front e usar BullMQ.

## Decisão
NestJS 12 em CommonJS (o suporte a ESM é opcional no 12 e não traz ganho
aqui), com módulos de domínio que só se comunicam por fachada (`index.ts`) e
eventos. Testes com Vitest + SWC (decorators e metadata).

## Consequências
- DI e guards do Nest resolvem RBAC e políticas de propriedade sem código
  caseiro.
- A fronteira entre módulos é verificada por lint, não só por convenção.
- Reescrever custa caro no curto prazo; o que existia de valor no .NET (extrator
  de nota fiscal, regras de permissão) é portado com seus testes.
