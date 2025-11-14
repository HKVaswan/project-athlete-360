// src/prismaClient.ts
import { PrismaClient } from "@prisma/client";
import logger from "./logger";

const prisma = new PrismaClient({
  log: [
    { level: "query", emit: "event" },
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
});

prisma.$on("query", (e) => {
  logger.debug(`[Prisma] query: ${e.query} (${e.duration}ms)`);
});
prisma.$on("warn", (e) => logger.warn("[Prisma] " + e.message));
prisma.$on("error", (e) => logger.error("[Prisma] " + e.message));

export default prisma;
export { prisma };