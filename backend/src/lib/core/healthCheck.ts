/**
 * src/lib/core/healthCheck.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade system health monitor.
 *
 * Provides centralized runtime health status of:
 *  - Database (Prisma)
 *  - Redis
 *  - Cache system
 *  - AI subsystem (if active)
 *  - Workers (BullMQ)
 *  - System uptime and memory usage
 *
 * Used by: /health endpoint, internal alerts, and uptime monitors.
 */

import { prisma } from "../../prismaClient";
import cache from "./cacheManager";
import { config } from "../../config";
import { queues, workers } from "../../workers";
import IORedis from "ioredis";
import os from "os";
import logger from "../../logger";

export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptimeSec: number;
  services: {
    database: string;
    redis: string;
    cache: string;
    workers: string;
    ai?: string;
  };
  metrics: {
    memoryMB: number;
    cpuLoad: number;
    activeWorkers: number;
    queuedJobs: number;
  };
  notes?: string;
}

const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
});

export async function performHealthCheck(): Promise<HealthReport> {
  const start = Date.now();

  let dbStatus = "unhealthy";
  let redisStatus = "unhealthy";
  let cacheStatus = "healthy";
  let workerStatus = "unhealthy";
  let aiStatus = "unknown";

  // ---- Database Health ----
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "healthy";
  } catch (err: any) {
    logger.error("[HEALTH] Database check failed:", err.message);
    dbStatus = "unhealthy";
  }

  // ---- Redis Health ----
  try {
    await redis.connect();
    await redis.ping();
    redisStatus = "healthy";
  } catch (err: any) {
    logger.warn("[HEALTH] Redis check failed:", err.message);
  } finally {
    redis.disconnect();
  }

  // ---- Cache Health ----
  try {
    await cache.set("health:test", "ok", { ttlSec: 5 });
    const v = await cache.get("health:test");
    cacheStatus = v === "ok" ? "healthy" : "unhealthy";
  } catch (err) {
    logger.warn("[HEALTH] Cache check failed:", (err as any)?.message);
    cacheStatus = "unhealthy";
  }

  // ---- Worker Health ----
  try {
    const activeWorkers = Object.keys(workers || {}).length;
    workerStatus = activeWorkers > 0 ? "healthy" : "degraded";
  } catch (err) {
    logger.warn("[HEALTH] Worker check failed:", (err as any)?.message);
  }

  // ---- AI Subsystem (if enabled) ----
  try {
    if (config.aiEnabled) {
      aiStatus = "healthy";
    } else {
      aiStatus = "disabled";
    }
  } catch {
    aiStatus = "unknown";
  }

  // ---- Metrics ----
  const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const cpuLoad = os.loadavg()[0];
  const activeWorkers = Object.keys(workers || {}).length;
  const queuedJobs = Object.keys(queues || {}).length;

  // ---- Status Aggregation ----
  const allHealthy =
    dbStatus === "healthy" &&
    redisStatus === "healthy" &&
    cacheStatus === "healthy" &&
    workerStatus === "healthy";

  const degraded =
    !allHealthy &&
    [dbStatus, redisStatus, cacheStatus, workerStatus].includes("degraded");

  const status = allHealthy ? "healthy" : degraded ? "degraded" : "unhealthy";

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    services: {
      database: dbStatus,
      redis: redisStatus,
      cache: cacheStatus,
      workers: workerStatus,
      ai: aiStatus,
    },
    metrics: {
      memoryMB,
      cpuLoad,
      activeWorkers,
      queuedJobs,
    },
    notes: `Checked in ${Date.now() - start}ms`,
  };
}

/**
 * Express route handler (optional helper)
 * Example:
 *   app.get("/health", async (_, res) => res.json(await getHealthReport()));
 */
export const getHealthReport = async () => {
  const report = await performHealthCheck();
  if (report.status !== "healthy") {
    logger.warn("[HEALTH] System degraded or unhealthy", report);
  }
  return report;
};