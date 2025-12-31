# ContentFern Cloud Edition
# Multi-stage build for production deployment

# =============================================================================
# Stage 1: Dependencies
# =============================================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy package files from both repos
# Note: In CI, both repos are cloned side by side
COPY contentfern-mono/package.json contentfern-mono/pnpm-lock.yaml contentfern-mono/pnpm-workspace.yaml ./contentfern-mono/
COPY contentfern-ee/package.json contentfern-ee/pnpm-workspace.yaml ./contentfern-ee/

# Copy all package.json files for workspace resolution
COPY contentfern-mono/packages/cms/package.json ./contentfern-mono/packages/cms/
COPY contentfern-mono/packages/trpc/package.json ./contentfern-mono/packages/trpc/
COPY contentfern-mono/packages/shared/package.json ./contentfern-mono/packages/shared/
COPY contentfern-mono/packages/ui/package.json ./contentfern-mono/packages/ui/
COPY contentfern-mono/ee/packages/auth/package.json ./contentfern-mono/ee/packages/auth/
COPY contentfern-mono/ee/packages/billing/package.json ./contentfern-mono/ee/packages/billing/
COPY contentfern-mono/ee/packages/provisioning/package.json ./contentfern-mono/ee/packages/provisioning/
COPY contentfern-mono/ee/packages/limits/package.json ./contentfern-mono/ee/packages/limits/
COPY contentfern-mono/ee/packages/admin/package.json ./contentfern-mono/ee/packages/admin/
COPY contentfern-ee/apps/cloud/package.json ./contentfern-ee/apps/cloud/

# Install dependencies
WORKDIR /app/contentfern-mono
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Builder
# =============================================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy node_modules from deps stage
COPY --from=deps /app/contentfern-mono/node_modules ./contentfern-mono/node_modules

# Copy source code from both repos
COPY contentfern-mono ./contentfern-mono
COPY contentfern-ee ./contentfern-ee

# Build packages in order
WORKDIR /app/contentfern-mono

# Build shared package
RUN pnpm --filter @contentfern/shared build

# Build CMS package
RUN pnpm --filter @contentfern/cms build

# Build tRPC package
RUN pnpm --filter @contentfern/trpc build

# Build UI package
RUN pnpm --filter @contentfern/ui build

# Build EE packages
RUN pnpm --filter @contentfern-ee/auth build || true
RUN pnpm --filter @contentfern-ee/billing build || true
RUN pnpm --filter @contentfern-ee/provisioning build || true
RUN pnpm --filter @contentfern-ee/limits build || true
RUN pnpm --filter @contentfern-ee/admin build || true

# Build cloud app
WORKDIR /app/contentfern-ee/apps/cloud
RUN pnpm build

# =============================================================================
# Stage 3: Production Runner
# =============================================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 contentfern

# Copy necessary files for production
COPY --from=builder /app/contentfern-mono/node_modules ./node_modules
COPY --from=builder /app/contentfern-mono/packages ./packages
COPY --from=builder /app/contentfern-mono/ee/packages ./ee/packages
COPY --from=builder /app/contentfern-ee/apps/cloud/dist ./apps/cloud/dist
COPY --from=builder /app/contentfern-ee/apps/cloud/server ./apps/cloud/server
COPY --from=builder /app/contentfern-ee/apps/cloud/package.json ./apps/cloud/

# Set ownership
RUN chown -R contentfern:nodejs /app

USER contentfern

WORKDIR /app/apps/cloud

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "--import", "tsx", "server/index.ts"]
