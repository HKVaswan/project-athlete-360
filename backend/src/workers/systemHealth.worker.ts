/**
 * src/workers/systemHealth.worker.ts
 * ------------------------------------------------------------------------
 * Enterprise System Health Worker
 *
 * Responsibilities:
 *  - Monitor CPU, memory, and disk utilization
 *  - Check database (Prisma) and Redis connectivity
 *  - Send alerts when thresholds are exceeded
 *  - Emit health metrics to monitoring pipeline
 */

import os from "os";
import { Job } from "bullmq";
import { logger } from "../logger";
import prisma from "../prismaClient";
import IORedis from "ioredis";
import { config } from "../config";
import { queues } from "./index";

const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
});

interface HealthReport {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage?: number;
  dbStatus: "healthy" | "unhealthy";
  redisStatus: "healthy" | "unhealthy";
  timestamp: string;
}

/**
 * Collects system metrics and connectivity statuses.
 */
async function collectHealthData(): Promise<HealthReport> {
  const cpuLoad = os.loadavg()[0]; // 1-min avg
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

  // Check DB connection
  let dbStatus: "healthy" | "unhealthy" = "healthy";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "unhealthy";
  }

  // Check Redis connection
  let redisStatus: "healthy" | "unhealthy" = "healthy";
  try {
    await redis.ping();
  } catch {
    redisStatus = "unhealthy";
  }

  return {
    cpuUsage: Number(cpuLoad.toFixed(2)),
    memoryUsage: Number(memoryUsage.toFixed(2)),
    dbStatus,
    redisStatus,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Evaluates thresholds and logs alerts if needed.
 */
function evaluateThresholds(report: HealthReport) {
  const issues: string[] = [];

  if (report.cpuUsage > 2) issues.push("⚠️ High CPU load (>2.0 avg)");
  if (report.memoryUsage > 85) issues.push("⚠️ High Memory Usage (>85%)");
  if (report.dbStatus === "unhealthy") issues.push("❌ Database unreachable");
  if (report.redisStatus === "unhealthy") issues.push("❌ Redis not responding");

  if (issues.length > 0) {
    logger.warn(`[SYSTEM HEALTH] Issues detected:\n${issues.join("\n")}`);
  } else {
    logger.info(`[SYSTEM HEALTH] ✅ System healthy. CPU: ${report.cpuUsage}, RAM: ${report.memoryUsage.toFixed(1)}%`);
  }
}

/**
 * Processor: Periodically checks and reports health metrics
 */
export default async function (job: Job) {
  logger.info(`[SYSTEM HEALTH WORKER] 🩺 Running system health check (Job ${job.id})`);

  try {
    const report = await collectHealthData();
    evaluateThresholds(report);

    // Optionally push metrics to monitoring queue or database
    const monitoringQueue = queues["monitoring"];
    if (monitoringQueue) {
      await monitoringQueue.add("systemHealthMetric", report, {
        removeOnComplete: true,
        attempts: 1,
      });
    }

    logger.info(`[SYSTEM HEALTH WORKER] ✅ Health check completed`);
  } catch (err: any) {
    logger.error(`[SYSTEM HEALTH WORKER] ❌ Error: ${err.message}`);
    throw err;
  }
}

/**
 * Optional: Schedule recurring system health checks
 */
export const scheduleSystemHealthJob = async () => {
  const queue = queues["systemHealth"];
  if (!queue) return;

  await queue.add(
    "systemHealthJob",
    {},
    {
      repeat: { every: 30 * 60 * 1000 }, // every 30 minutes
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  logger.info(`[SYSTEM HEALTH WORKER] ⏱️ Scheduled system health job (every 30 mins).`);
};