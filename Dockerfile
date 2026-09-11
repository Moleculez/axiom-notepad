# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/sync/package.json apps/sync/package.json
COPY packages/editor/package.json packages/editor/package.json
COPY packages/markdown/package.json packages/markdown/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --fetch-timeout=60000 --fetch-retries=2

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 AXIOM_DIST_DIR=.next
# Build-only placeholders are not persisted in ENV; private .env files are excluded.
RUN npm run build
RUN rm -rf /app/apps/web/.next/cache /app/apps/web/.next/types /app/apps/web/.next/dev

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts
# Optional peers of Next/Better Auth can retain test runners after npm pruning.
# They are never imported by application code and are not runtime tooling.
RUN rm -rf /app/node_modules/@playwright /app/node_modules/playwright /app/node_modules/playwright-core /app/node_modules/vitest /app/node_modules/@vitest /app/node_modules/vite

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 AXIOM_DIST_DIR=.next PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/apps/web/package.json /app/apps/web/next.config.ts ./apps/web/
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/apps/sync ./apps/sync
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts/ops/admin.ts /app/scripts/ops/backup.ts /app/scripts/ops/migrate.ts /app/scripts/ops/workspace-worker.ts /app/scripts/ops/environment.ts /app/scripts/ops/validate-env.ts ./scripts/ops/
COPY --chmod=755 deploy/docker/entrypoint.sh /usr/local/bin/axiom-entrypoint
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
EXPOSE 3000 1234
ENTRYPOINT ["axiom-entrypoint"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]

# Operations carry pg_dump/pg_restore 16; the ordinary web image does not.
FROM postgres:16-bookworm AS operations
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime --chown=1000:1000 /app /app
COPY --chmod=755 deploy/docker/entrypoint.sh /usr/local/bin/axiom-entrypoint
RUN groupadd --gid 1000 axiom && useradd --uid 1000 --gid 1000 --no-create-home axiom && mkdir -p /backups /restore && chown 1000:1000 /backups /restore
USER 1000:1000
ENTRYPOINT ["axiom-entrypoint"]
CMD ["node", "--import", "tsx", "scripts/ops/backup.ts"]
