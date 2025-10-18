# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma

# Build TypeScript → JS
RUN npm run build

# ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY --from=builder /usr/src/app/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

EXPOSE 5000
CMD ["node", "dist/server.js"]
