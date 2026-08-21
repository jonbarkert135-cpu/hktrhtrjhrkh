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
COPY packages/integrations/package.json packages/integrations/
COPY packages/ui/package.json packages/ui/
COPY bench/package.json bench/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# @nexus/db is the only dependency of the api with a build step (prisma generate).
RUN pnpm --filter @nexus/db run build

# Production dependency tree, installed from scratch.
#
# `pnpm prune --prod` is NOT enough in a workspace: it rewrites the root node_modules links but
# leaves every dev package inside the virtual store (node_modules/.pnpm), so the runtime image
# still shipped esbuild, babel, vitest & co. — and the Trivy gate flagged their vulnerabilities
# (15_SECURITY.md §9.4). A separate, filtered `--prod` install produces a tree that only contains
# what `node apps/api/src/server.ts` actually loads.
FROM deps AS proddeps
WORKDIR /repo
COPY packages/db/prisma packages/db/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules bench/node_modules e2e/node_modules && \
    pnpm install --frozen-lockfile --prod --filter "@nexus/api..."
# The Prisma CLI is a dev dependency, so it is fetched for this single command instead of being
# installed into the tree. The version is pinned to the one in pnpm-lock.yaml (@prisma/client).
RUN pnpm dlx prisma@6.19.3 generate --schema=packages/db/prisma/schema.prisma
# `auto-install-peers=true` (.npmrc) materialises the optional peers of the runtime dependencies,
# which drags bundlers and test runners (vite -> esbuild, vitest, jsdom, …) into the --prod tree.
# The server never loads them, so they are removed; see scripts/prune-runtime-store.mjs.
COPY scripts/prune-runtime-store.mjs scripts/prune-runtime-store.mjs
RUN node scripts/prune-runtime-store.mjs
# A workspace package without production dependencies gets no node_modules directory; the runtime
# stage copies these paths unconditionally, so make sure they exist.
RUN mkdir -p apps/api/node_modules packages/config/node_modules packages/db/node_modules \
             packages/domain/node_modules

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# The runtime only ever runs `node`. Removing the package managers bundled into the base image
# drops their vendored dependencies (npm bundles tar, sigstore, ip-address, brace-expansion …)
# from the attack surface and from the vulnerability report.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /repo
# Sources first, then the production dependency tree on top: the per-package node_modules of the
# build stage point into a virtual store that does not exist here, so they are replaced wholesale.
COPY --from=build --chown=65532:65532 /repo/package.json ./package.json
COPY --from=build --chown=65532:65532 /repo/apps/api ./apps/api
COPY --from=build --chown=65532:65532 /repo/packages/config ./packages/config
COPY --from=build --chown=65532:65532 /repo/packages/db ./packages/db
COPY --from=build --chown=65532:65532 /repo/packages/domain ./packages/domain
COPY --from=build --chown=65532:65532 /repo/packages/integrations ./packages/integrations
RUN rm -rf node_modules apps/api/node_modules packages/config/node_modules \
           packages/db/node_modules packages/domain/node_modules packages/integrations/node_modules
COPY --from=proddeps --chown=65532:65532 /repo/node_modules ./node_modules
COPY --from=proddeps --chown=65532:65532 /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=proddeps --chown=65532:65532 /repo/packages/config/node_modules ./packages/config/node_modules
COPY --from=proddeps --chown=65532:65532 /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=proddeps --chown=65532:65532 /repo/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=proddeps --chown=65532:65532 /repo/packages/integrations/node_modules ./packages/integrations/node_modules
USER 65532:65532
EXPOSE 3001 9464
# Internal packages are source-only (no build step), so the runtime strips types natively
# instead of shipping a bundler or tsx into the production image.
CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
