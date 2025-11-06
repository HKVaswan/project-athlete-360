#!/usr/bin/env bash
set -euo pipefail

# Allow override of startup behavior via env vars
: "${NODE_ENV:=production}"
: "${MIGRATE_ON_START:=false}"
: "${DATABASE_URL:=}"

echo "[entrypoint] Starting container (env=${NODE_ENV})"

# Optional: run Prisma migrations at startup (only when explicitly enabled)
if [ "${MIGRATE_ON_START}" = "true" ]; then
  echo "[entrypoint] MIGRATE_ON_START=true — running prisma migrate deploy"
  # Only run if prisma exists and DATABASE_URL provided
  if [ -f ./prisma/schema.prisma ] && [ -n "${DATABASE_URL}" ]; then
    npx prisma migrate deploy --schema=prisma/schema.prisma || {
      echo "[entrypoint] prisma migrate failed"; exit 1;
    }
  else
    echo "[entrypoint] Skipping migrations: prisma/schema.prisma missing or DATABASE_URL unset"
  fi
fi

# Preflight health: check DB connectivity (non-fatal, logs a warning)
if [ -n "${DATABASE_URL}" ]; then
  echo "[entrypoint] Checking database connectivity..."
  ( npx prisma db pull --schema=prisma/schema.prisma ) || echo "[entrypoint] DB check failed (continuing)"
fi

exec "$@"