/**
 * workers/cleanup.worker.ts
 * -------------------------------------------------------------
 * System Cleanup Worker (Enterprise Grade)
 *
 * Periodically removes stale data, expired tokens, and temporary
 * files from the system to ensure long-term stability and performance.
 *
 * Features:
 *  - Safe transactional deletes (date-based)
 *  - Configurable retention via ENV
 *  - Full logging for traceability
 *  - Non-blocking, retryable, and idempotent
 */

import { Job } from "bullmq";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

// Redis connection for cleanup tasks
const redisConnection = new IORedis(config.redisUrl || "redis://127.0.0.1:6379");

// Optional: Notify admin if cleanup fails critically
const emailQueue = new Queue("email", { connection: redisConnection });

const DEFAULT_RETENTION_DAYS = 90;
const TEMP_FILE_RETENTION_HOURS = 12;

/**
 * Helper: Calculate date threshold based on retention period.
 */
function retentionDate(days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

/**
 * Helper: Safe deletion with logging.
 */
async function safeDelete(label: string, fn: () => Promise<number>) {
  try {
    const count = await fn();
    if (count > 0) logger.info(`[CLEANUP] 🧹 ${label}: ${count} records removed.`);
  } catch (err: any) {
    logger.error(`[CLEANUP] ❌ ${label} cleanup failed: ${err.message}`);
    await emailQueue.add("cleanupAlert", {
      type: "cleanup-alert",
      payload: {
        to: config.securityAlertEmails || "admin@pa360.net",
        inviter: "System",
        title: `Cleanup Failed: ${label}`,
        content: `Error: ${err.message}`,
      },
    });
  }
}

/**
 * Deletes expired sessions & tokens.
 */
async function cleanupExpiredSessions() {
  const cutoff = retentionDate(30);
  return prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).then(r => r.count);
}

/**
 * Deletes expired refresh tokens (older than 60 days)
 */
async function cleanupExpiredTokens() {
  const cutoff = retentionDate(60);
  return prisma.refreshToken.deleteMany({
    where: { issuedAt: { lt: cutoff } },
  }).then(r => r.count);
}

/**
 * Deletes old audit logs (if table exists)
 */
async function cleanupOldLogs() {
  const cutoff = retentionDate(DEFAULT_RETENTION_DAYS);
  try {
    // @ts-ignore (audit_logs may not exist yet)
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  } catch {
    return 0; // skip if table not found
  }
}

/**
 * Deletes orphaned athlete or competition records.
 */
async function cleanupOrphans() {
  let total = 0;

  // Orphaned athlete profiles
  const orphanAthletes = await prisma.athlete.deleteMany({
    where: { userId: null },
  });
  total += orphanAthletes.count;

  // Orphaned resources
  const orphanResources = await prisma.resource.deleteMany({
    where: { uploaderId: null },
  });
  total += orphanResources.count;

  return total;
}

/**
 * Deletes temp files older than TEMP_FILE_RETENTION_HOURS
 */
async function cleanupTempFiles() {
  const tempDir = path.join(__dirname, "../../temp");
  if (!fs.existsSync(tempDir)) return 0;

  const cutoff = Date.now() - TEMP_FILE_RETENTION_HOURS * 60 * 60 * 1000;
  let removed = 0;

  for (const file of fs.readdirSync(tempDir)) {
    const fullPath = path.join(tempDir, file);
    const stats = fs.statSync(fullPath);
    if (stats.mtimeMs < cutoff) {
      fs.unlinkSync(fullPath);
      removed++;
    }
  }

  return removed;
}

/**
 * Main Cleanup Worker
 */
export default async function (job: Job) {
  const trace = `CLEANUP-${job.id}-${Date.now()}`;
  logger.info(`[CLEANUP] 🧩 Starting cleanup job ${trace}`);

  const start = Date.now();

  try {
    const results = await Promise.all([
      safeDelete("Expired Sessions", cleanupExpiredSessions),
      safeDelete("Expired Refresh Tokens", cleanupExpiredTokens),
      safeDelete("Old Logs", cleanupOldLogs),
      safeDelete("Orphan Records", cleanupOrphans),
      safeDelete("Temp Files", cleanupTempFiles),
    ]);

    const duration = Date.now() - start;
    logger.info(`[CLEANUP] ✅ Job ${trace} completed in ${duration}ms`);

    return { success: true, duration };
  } catch (err: any) {
    logger.error(`[CLEANUP] ❌ Job ${trace} failed: ${err.message}`);

    await emailQueue.add("cleanupError", {
      type: "cleanup-error",
      payload: {
        to: config.securityAlertEmails || "admin@pa360.net",
        title: "System Cleanup Failed",
        content: `Job ${trace} failed: ${err.message}`,
      },
    });

    throw err;
  }
}