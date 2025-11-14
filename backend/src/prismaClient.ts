// src/prismaClient.ts
import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

const prisma = new PrismaClient({
  log: [
    { level: "info", emit: "event" },
    { level: "query", emit: "event" },
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" }
  ]
});

prisma.$on("query", (e) => {
  logger.debug(`[PRISMA QUERY] ${e.query} (${e.duration}ms)`, { params: e.params });
});
prisma.$on("info", (e) => logger.info(`[PRISMA INFO] ${e.message}`));
prisma.$on("warn", (e) => logger.warn(`[PRISMA WARN] ${e.message}`));
prisma.$on("error", (e) => logger.error(`[PRISMA ERROR] ${e.message}`));

export default prisma;
export { prisma };