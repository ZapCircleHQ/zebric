# Production Dockerfile for Zebric
# Multi-stage build for minimal production image

FROM node:20-alpine AS base

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

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/cli/package.json ./packages/cli/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Build stage
FROM base AS build

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/cli/package.json ./packages/cli/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY tsconfig.json ./

# Build the application
RUN pnpm build

# Production stage
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/runtime/node_modules ./packages/runtime/node_modules
COPY --from=deps --chown=nodejs:nodejs /app/packages/cli/node_modules ./packages/cli/node_modules

# Copy built application
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/cli/dist ./packages/cli/dist
COPY --from=build --chown=nodejs:nodejs /app/package.json ./
COPY --from=build --chown=nodejs:nodejs /app/packages/runtime/package.json ./packages/runtime/
COPY --from=build --chown=nodejs:nodejs /app/packages/cli/package.json ./packages/cli/

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
CMD ["node", "packages/cli/dist/index.js", "start", "-b", "/app/blueprint.toml"]
