// backend/src/prismaClient.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "./config";

type PrismaLogLevel = Prisma.LogLevel | Prisma.LogLevel[];

/**
 * Production-oriented PrismaClient singleton.
 * - Enables sensible logging in non-production.
 * - Catches query errors and logs helpful info.
 * - Graceful shutdown on SIGTERM/SIGINT (useful in container orchestration).
 */

const enableQueryLogging = config.env !== "production";

const prisma = new PrismaClient({
  log: enableQueryLogging
    ? [
        { level: "query", emit: "event" },
        { level: "info", emit: "event" },
        { level: "warn", emit: "event" },
        { level: "error", emit: "event" },
      ]
    : [{ level: "error", emit: "event" }],
});

// Forward Prisma events into console or logger (logger will be added in app)
prisma.$on("query", (e) => {
  if (enableQueryLogging) {
    // Avoid logging potentially huge query params here — use with care in prod
    // eslint-disable-next-line no-console
    console.debug(`[PRISMA][Query] ${e.query} (${e.duration}ms)`);
  }
});

prisma.$on("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[PRISMA][Error]", e);
});

// Graceful shutdown helpers
const shutdown = async (signal: string) => {
  // eslint-disable-next-line no-console
  console.info(`[PRISMA] Received ${signal}. Disconnecting Prisma client...`);
  try {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.info("[PRISMA] Disconnected.");
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PRISMA] Error during disconnect:", err);
    process.exit(1);
  }
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

export default prisma;
