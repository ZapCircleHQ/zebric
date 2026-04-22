FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY benchmark ./benchmark

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @zebric/runtime-core build \
 && pnpm --filter @zebric/runtime-hono build \
 && pnpm --filter @zebric/notifications build \
 && pnpm --filter @zebric/observability build \
 && pnpm --filter @zebric/runtime-node build \
 && pnpm --filter @zebric/cli build

ENV NODE_ENV=production

ENTRYPOINT ["/usr/bin/tini", "--"]
