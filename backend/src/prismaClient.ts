// src/prismaClient.ts
/**
 * 🛠️ Prisma Client Initialization (Updated Enterprise Version)
 * ---------------------------------------------------------------------------
 * - Integrates with the central Winston logger for all database events.
 * - Implements soft-delete middleware for User and Athlete models.
 * - Maintains graceful shutdown hooks (SIGINT/SIGTERM).
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "./config";
import logger, { createLogger } from "./logger"; // <-- CRITICAL: Use central logger
import { shutdownLogger } from "./logger";

// Create a contextual logger specifically for database events
const prismaLogger = createLogger("Prisma");

// The query duration threshold (in ms) to consider a query "slow" and log it as a warning.
const SLOW_QUERY_THRESHOLD_MS = 1000;

// 1. Determine log levels (Using Prisma's standard `log` array)
const logLevels: Prisma.LogLevel[] = [];
if (config.env !== "production") {
  // Log 'query' events only in development/test
  logLevels.push("query");
}
// Log warnings and errors in all environments
logLevels.push("warn", "error");


// 2. Instantiate the client
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.databaseUrl,
    },
  },
  log: logLevels.map(level => ({ level, emit: "event" })), // Emit as events to be handled below
});


// 3. Hook into Prisma Events and forward to Winston Logger
// Note: We are using $on instead of $use for query logging to honor the existing convention.

// Forward query events to the logger, with slow query detection
prisma.$on("query", (e) => {
  const queryTime = e.duration;
  const logDetails = {
    target: "prisma_query",
    query: e.query,
    params: e.params,
    queryTimeMs: queryTime,
  };

  if (queryTime > SLOW_QUERY_THRESHOLD_MS) {
    prismaLogger.warn(`🐢 Slow Query Detected (${queryTime}ms)`, logDetails);
  } else if (config.env !== "production") {
    // Log standard queries in dev/test as debug
    prismaLogger.debug(`DB Query Executed (${queryTime}ms)`, logDetails);
  }
});

prisma.$on("warn", (e) => {
  prismaLogger.warn(`[Prisma Warning] ${e.message}`, { target: "prisma_warning", details: e });
});

prisma.$on("error", (e) => {
  prismaLogger.error(`[Prisma Error] ${e.message}`, { target: "prisma_error", details: e });
});

// 4. Implement Soft Delete Middleware (Crucial for data governance)
prisma.$use(async (params, next) => {
  if (params.model === 'User' || params.model === 'Athlete') {
    if (params.action === 'delete') {
      params.action = 'update';
      params.args['data'] = { deleted: true, deletedAt: new Date() };
    }
    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      params.args['data'] = { deleted: true, deletedAt: new Date() };
    }
    // Also, ensure SELECTs automatically filter out soft-deleted records (optional but common)
    if (params.action === 'findUnique' || params.action === 'findMany' || params.action === 'findFirst') {
        params.args['where'] = {
            ...params.args['where'],
            deleted: false,
        };
    }
  }

  return next(params);
});


// 5. Graceful Shutdown (Retained from the original file, but integrated with logger shutdown)
const gracefulShutdown = async (signal: string) => {
  logger.info(`[SHUTDOWN] Received ${signal}. Disconnecting Prisma client...`);
  try {
    // 1. Disconnect Prisma
    await prisma.$disconnect();
    logger.info("[SHUTDOWN] Prisma disconnected.");

    // 2. Disconnect Logger/Telemetry (if necessary)
    await shutdownLogger();

    process.exit(0);
  } catch (err) {
    logger.error("[SHUTDOWN] Error during graceful disconnect:", err);
    // Force exit if disconnect fails
    process.exit(1);
  }
};

process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 6. Final Export
export default prisma;
