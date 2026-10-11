# Site (Next.js) em modo standalone: só o necessário para rodar, sem node_modules completo.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# A regra de repasse /api → API é gravada no build. Em produção o Traefik já
# manda /api direto para a API; este valor cobre o acesso interno.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_OUTPUT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @soscomida/web...
RUN pnpm turbo run build --filter @soscomida/web

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:3000/como-funciona || exit 1
CMD ["node", "apps/web/server.js"]
