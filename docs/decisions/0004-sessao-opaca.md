# 0004 — Sessão opaca em cookie em vez de JWT no navegador

**Status:** aceito · 2026-10-10

## Contexto
O front antigo guardava JWT no `localStorage` (exposto a XSS) e a revogação
dependia da expiração do token. Desativar um moderador não tinha efeito
imediato sem consultar o banco a cada requisição de qualquer jeito.

## Decisão
Token aleatório (32 bytes) em cookie `HttpOnly; Secure; SameSite=Lax`, com
prefixo `__Host-` em produção. O banco guarda o SHA-256. Cada requisição
autenticada faz uma busca por índice único (`sessions.token_hash`) — custo
desprezível nos volumes previstos; no estágio 2, cache curto em Redis.

## Consequências
- Logout, troca de senha e desativação valem na hora.
- MFA fica registrado na sessão (`mfa_verified`).
- Front e API precisam estar no mesmo site (Next faz proxy de `/api` em dev;
  Traefik roteia em produção). Clientes nativos futuros podem usar o mesmo
  token via cabeçalho `Authorization: Bearer`.
- CSRF: `SameSite=Lax` + verificação de `Origin` nas requisições que alteram
  estado.
