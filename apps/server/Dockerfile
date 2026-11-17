# C30 server Dockerfile
FROM node:20-alpine AS builder

# pnpm
RUN corepack enable

WORKDIR /app

# 复制 workspace 清单(用于 pnpm 解析 workspace 依赖)
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/mdsd/package.json packages/mdsd/

RUN pnpm install --frozen-lockfile

# 复制源码
COPY apps/server apps/server
COPY packages/shared packages/shared

RUN pnpm --filter @c30/server build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/node_modules ./node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY apps/server/prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/main.js"]
