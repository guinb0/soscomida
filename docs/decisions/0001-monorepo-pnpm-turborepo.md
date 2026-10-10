# 0001 — Monorepo com pnpm workspaces e Turborepo

**Status:** aceito · 2026-10-10

## Contexto
Front e back viviam em repositórios separados e os contratos da API eram
redigitados no front (e divergiam: o front esperava `nome`, a API mandava
`nomeUsuario`, e uma tela quebrava por isso).

## Decisão
Um repositório com `apps/web`, `apps/api` e pacotes `contracts`, `shared` e
`config`. pnpm workspaces para dependências; Turborepo para orquestrar `build`,
`lint`, `typecheck` e `test` com cache.

## Consequências
- Os schemas Zod de `@soscomida/contracts` validam a entrada na API e tipam o
  front: uma mudança de contrato quebra a compilação dos dois lados.
- Turborepo é dispensável hoje (3 pacotes), mas custa um arquivo de config e
  evita recompilar tudo no CI. Se atrapalhar, sai sem afetar o código.
