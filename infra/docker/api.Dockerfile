# Imagem única para API e worker (ADR 0007): o comando define o processo.
#   API:    node dist/main.js
#   Worker: node dist/worker.js
#   Migração: node dist/infra/db/migrate.js
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @soscomida/api...
RUN pnpm turbo run build --filter @soscomida/api
RUN pnpm --filter @soscomida/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:4000/api/health/live || exit 1
CMD ["node", "dist/main.js"]
