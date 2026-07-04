# Production Dockerfile for Zebric
# Multi-stage build for minimal production image

FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    tini

# Dependencies stage
FROM base AS deps

# Copy the production runtime's dependency closure (full source, not just
# manifests: packages/runtime-core has a postinstall script that needs its
# own source files present): cli -> runtime-node -> {runtime-core,
# runtime-hono, notifications, observability}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/runtime-core ./packages/runtime-core
COPY packages/runtime-hono ./packages/runtime-hono
COPY packages/runtime-node ./packages/runtime-node
COPY packages/notifications ./packages/notifications
COPY packages/observability ./packages/observability
COPY packages/cli ./packages/cli

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Build stage
FROM base AS build

# Copy the same source closure as the deps stage
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json turbo.json ./
COPY packages/runtime-core ./packages/runtime-core
COPY packages/runtime-hono ./packages/runtime-hono
COPY packages/runtime-node ./packages/runtime-node
COPY packages/notifications ./packages/notifications
COPY packages/observability ./packages/observability
COPY packages/cli ./packages/cli

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Build the application (turbo only sees the packages copied above)
RUN pnpm build

# Production stage
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/runtime-core/node_modules ./packages/runtime-core/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/runtime-hono/node_modules ./packages/runtime-hono/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/runtime-node/node_modules ./packages/runtime-node/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/notifications/node_modules ./packages/notifications/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/observability/node_modules ./packages/observability/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/cli/node_modules ./packages/cli/node_modules

# Copy built application
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-core/dist ./packages/runtime-core/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-core/package.json ./packages/runtime-core/
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-hono/dist ./packages/runtime-hono/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-hono/package.json ./packages/runtime-hono/
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-node/dist ./packages/runtime-node/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime-node/package.json ./packages/runtime-node/
COPY --from=build --chown=nodejs:nodejs /app/packages/notifications/dist ./packages/notifications/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/notifications/package.json ./packages/notifications/
COPY --from=build --chown=nodejs:nodejs /app/packages/observability/dist ./packages/observability/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/observability/package.json ./packages/observability/
COPY --from=build --chown=nodejs:nodejs /app/packages/cli/dist ./packages/cli/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/cli/package.json ./packages/cli/
COPY --from=build --chown=nodejs:nodejs /app/package.json ./

# Create directories for data and ensure proper permissions
RUN mkdir -p /app/data /app/static && \
    chown -R nodejs:nodejs /app/data /app/static

# Switch to non-root user
USER nodejs

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "packages/cli/dist/engine-runner.js", "--blueprint", "/app/blueprint.toml"]
