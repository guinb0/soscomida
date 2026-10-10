# 0003 — Drizzle ORM em vez de Prisma

**Status:** aceito · 2026-10-10

## Contexto
O núcleo financeiro depende de recursos do PostgreSQL que precisam estar
explícitos no código: `CHECK`, índices únicos parciais,
`SELECT ... FOR UPDATE SKIP LOCKED` (outbox e alocação de notas), constraint
triggers diferidas (ledger balanceado) e transações curtas controladas à mão.

## Decisão
Drizzle ORM com driver `pg`. Schema em TypeScript, migrações SQL geradas pelo
Drizzle Kit e **revisadas/complementadas à mão** (triggers).

## Alternativas
- **Prisma:** ecossistema maior, mas `FOR UPDATE SKIP LOCKED`, `CHECK` e
  triggers exigem `$queryRaw`/SQL manual fora do schema, e o motor separado
  aumenta a imagem. Vantagem de produtividade não compensa no núcleo
  financeiro.
- **SQL puro (Kysely/pg):** máximo controle, mas sem schema tipado como fonte
  das migrações.

## Consequências
Consultas legíveis como SQL, tipagem forte, nenhum binário extra. Equipe
precisa revisar o SQL gerado em cada migração (bom hábito para dinheiro).
