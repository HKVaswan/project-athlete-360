import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

// ───────────────────────────────
// 🧠 Singleton Prisma Client
// ───────────────────────────────

// Prevent creating multiple Prisma instances in dev hot-reload environments
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Prisma initialization with detailed logging in dev mode
const prisma =
  global.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["query", "info", "warn", "error"],
  });

// Attach global prisma to avoid multiple connections in dev
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

// ───────────────────────────────
// 🛡 Graceful Shutdown
// ───────────────────────────────
const shutdown = async () => {
  logger.info("🛑 Shutting down Prisma connection...");
  await prisma.$disconnect();
  logger.info("✅ Prisma connection closed gracefully.");
};

// Listen for process termination signals
process.on("beforeExit", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ───────────────────────────────
// 🚀 Export Singleton
// ───────────────────────────────
export { prisma };
