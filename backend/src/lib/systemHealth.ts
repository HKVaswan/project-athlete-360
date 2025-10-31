import prisma from "../prismaClient";
import IORedis from "ioredis";
import { checkWorkerHealth } from "../workers";
import { logger } from "../logger";
import { config } from "../config";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface SystemHealthReport {
  status: HealthStatus;
  timestamp: string;
  services: {
    database: HealthStatus;
    redis: HealthStatus;
    workers: HealthStatus;
    ai?: HealthStatus;
  };
  meta: {
    uptime: string;
    environment: string;
    version: string;
  };
}

/**
 * Ping PostgreSQL (via Prisma)
 */
const checkDatabase = async (): Promise<HealthStatus> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "healthy";
  } catch (err) {
    logger.error("[HEALTH] Database check failed:", err);
    return "unhealthy";
  }
};

/**
 * Check Redis connectivity
 */
const checkRedis = async (): Promise<HealthStatus> => {
  try {
    const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379");
    await redis.ping();
    await redis.quit();
    return "healthy";
  } catch (err) {
    logger.error("[HEALTH] Redis check failed:", err);
    return "unhealthy";
  }
};

/**
 * Check worker and AI job health
 */
const checkWorkersAndAI = async (): Promise<{ workers: HealthStatus; ai: HealthStatus }> => {
  try {
    const workerStatus = await checkWorkerHealth();
    const workers = workerStatus.activeWorkers > 0 ? "healthy" : "degraded";
    const ai = workerStatus.queues.includes("aiProcessing") ? "healthy" : "degraded";
    return { workers, ai };
  } catch (err) {
    logger.error("[HEALTH] Worker/AI check failed:", err);
    return { workers: "unhealthy", ai: "unhealthy" };
  }
};

/**
 * Aggregate system health
 */
export const getSystemHealth = async (): Promise<SystemHealthReport> => {
  const [database, redis, workerData] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkWorkersAndAI(),
  ]);

  const overallStatus: HealthStatus =
    database === "healthy" && redis === "healthy" && workerData.workers === "healthy"
      ? "healthy"
      : "degraded";

  const uptime = `${Math.floor(process.uptime() / 60)} mins`;

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      database,
      redis,
      workers: workerData.workers,
      ai: workerData.ai,
    },
    meta: {
      uptime,
      environment: process.env.NODE_ENV || "development",
      version: process.env.APP_VERSION || "1.0.0",
    },
  };
};

/**
 * Optional: Trigger internal alerts when status is degraded/unhealthy
 */
export const alertIfUnhealthy = async (health: SystemHealthReport) => {
  if (health.status !== "healthy") {
    logger.warn("[ALERT] 🚨 System health degraded", health);
    // Later: Integrate with Slack / Email / SMS / AI monitoring here
  }
};