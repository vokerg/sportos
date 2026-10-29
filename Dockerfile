FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps apps
RUN pnpm build:backend && pnpm build:web:hosted
# deploy makes isolated production trees with resolved pnpm workspace links.
RUN pnpm --filter @sportos/api deploy --prod /out/api \
 && pnpm --filter @sportos/worker deploy --prod /out/worker

FROM node:22-bookworm-slim AS api
LABEL org.opencontainers.image.source="https://github.com/vokerg/sportos"
ENV NODE_ENV=production API_PORT=3010
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim AS worker
LABEL org.opencontainers.image.source="https://github.com/vokerg/sportos"
ENV NODE_ENV=production
WORKDIR /workspace/apps/worker
COPY --from=build --chown=node:node /out/worker ./
USER node
CMD ["node", "dist/import-worker.js"]

FROM nginxinc/nginx-unprivileged:stable-alpine AS web
LABEL org.opencontainers.image.source="https://github.com/vokerg/sportos"
COPY --from=build /workspace/apps/web/dist/web/browser /usr/share/nginx/html
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
