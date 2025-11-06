# ----------------------------
# Stage 1 — builder
# ----------------------------
# Use Debian-based image (stable Prisma/native binary compatibility)
FROM node:20-bullseye AS builder

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Set working dir
WORKDIR /app

# Install build tooling required for native modules and prisma generation
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    build-essential \
    libc6-dev \
    libssl-dev \
    openssh-client \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Copy lockfile + package manifests first for caching
COPY package*.json ./
# If you use pnpm or yarn, adapt accordingly:
# COPY pnpm-lock.yaml ./
# RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies (full install to allow prisma generate)
RUN npm ci --unsafe-perm

# Copy source
COPY . .

# Generate Prisma client (if using Prisma)
# Ensure DATABASE_URL is not required at build time; set a dummy if necessary via build-arg
ARG DATABASE_URL="file:./dev.db"
ENV DATABASE_URL=${DATABASE_URL}
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate --schema=prisma/schema.prisma; fi

# Build TypeScript to JS (if applicable)
# Adjust command if your project uses tsc project config in package.json scripts
RUN npm run build || (echo "No build step detected or build failed; continuing")

# ----------------------------
# Stage 2 — runtime
# ----------------------------
FROM node:20-bullseye-slim AS runner

LABEL org.opencontainers.image.title="Project Athlete 360 - Backend"
LABEL org.opencontainers.image.description="Enterprise-grade backend service"
LABEL org.opencontainers.image.license="MIT"

ENV NODE_ENV=production
ARG APP_PORT=4000
ENV PORT=${APP_PORT}

WORKDIR /app

# Create non-root user for security
RUN groupadd -r app && useradd -r -g app app \
  && mkdir -p /app/logs /app/tmp /backups \
  && chown -R app:app /app /backups

# Install a minimal set of runtime deps (for Prisma and libs)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates \
     libssl-dev \
     openssl \
     curl \
  && rm -rf /var/lib/apt/lists/*

# Copy only production dependencies and built artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/backups /backups

# Set permissions
RUN chown -R app:app /app
USER app

# Expose port
EXPOSE ${PORT}

# Healthcheck (Docker will use this to mark container healthy/unhealthy)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Recommended small startup: use npm start script that runs node ./dist/server.js
# Ensure package.json has a "start" script that starts the built app in production.
ENV NODE_OPTIONS="--enable-source-maps"

# Use a safe entrypoint: run migrations conditionally then start
# The entrypoint script will be executed as non-root user
COPY ./docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]