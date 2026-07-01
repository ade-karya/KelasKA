# ---- Stage 1: Base ----
FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# ---- Stage 2: Dependencies ----
FROM base AS deps

# Native build tools for sharp, @napi-rs/canvas
RUN apk add --no-cache python3 build-base g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev openssl-dev

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY packages/ ./packages/
COPY prisma/ ./prisma/
COPY scripts/ ./scripts/

RUN pnpm install --no-frozen-lockfile
RUN npx prisma generate

# ---- Stage 3: Builder ----
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

RUN pnpm build

# ---- Stage 4: Runner ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache libc6-compat cairo pango jpeg giflib librsvg openssl wget

RUN npm install -g prisma@6.19.3

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["sh", "-c", "prisma migrate deploy && node server.js"]
