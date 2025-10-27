// src/prismaClient.ts
import { PrismaClient } from "@prisma/client";

// ───────────────────────────────
// 🌍 Environment-Aware Prisma Setup
// ───────────────────────────────

// Enable Prisma query logging in development
const isDev = process.env.NODE_ENV !== "production";

// Prevent creating multiple Prisma instances in dev (hot reload)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: isDev
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "error" },
          { emit: "stdout", level: "warn" },
        ]
      : ["error"],
    errorFormat: isDev ? "pretty" : "minimal",
  });

// ───────────────────────────────
// 🧠 Optional: Query Performance Logger
// ───────────────────────────────
if (isDev) {
  prisma.$on("query", (e) => {
    console.log(
      `🧩 [Query] ${e.duration}ms → ${e.query} ${
        e.params && e.params !== "[]" ? `| params: ${e.params}` : ""
      }`
    );
  });
}

// ───────────────────────────────
// 🧹 Graceful Shutdown Hook
// ───────────────────────────────
process.on("beforeExit", async () => {
  console.log("👋 Prisma client is disconnecting...");
  await prisma.$disconnect();
});

// Reuse instance in dev (avoid "too many connections" errors)
if (isDev) globalForPrisma.prisma = prisma;

export default prisma;