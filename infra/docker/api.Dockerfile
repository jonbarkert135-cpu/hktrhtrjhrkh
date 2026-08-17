# syntax=docker/dockerfile:1
# Build context is the repository root.
FROM node:22-alpine AS deps
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/ui/package.json packages/ui/
COPY bench/package.json bench/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# @nexus/db is the only dependency of the api with a build step (prisma generate).
RUN pnpm --filter @nexus/db run build
# Prune to production dependencies; the runtime image carries no dev deps.
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=65532:65532 /repo/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /repo/package.json ./package.json
COPY --from=build --chown=65532:65532 /repo/apps/api ./apps/api
COPY --from=build --chown=65532:65532 /repo/packages/config ./packages/config
COPY --from=build --chown=65532:65532 /repo/packages/db ./packages/db
COPY --from=build --chown=65532:65532 /repo/packages/domain ./packages/domain
USER 65532:65532
EXPOSE 3001 9464
# Internal packages are source-only (no build step), so the runtime strips types natively
# instead of shipping a bundler or tsx into the production image.
CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
