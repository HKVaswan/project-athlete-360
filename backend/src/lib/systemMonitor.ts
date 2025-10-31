/**
 * src/lib/systemMonitor.ts
 * -------------------------------------------------------------------------
 * Enterprise System Monitor
 *
 * Features:
 *  - Tracks CPU, memory, disk, and queue performance
 *  - Sends alerts for high usage to audit + analytics systems
 *  - Designed for Super Admin observability dashboards
 *  - Runs automatically in worker or server environments
 */

import os from "os";
import { performance } from "perf_hooks";
import fs from "fs";
import { logger } from "../logger";
import { queues } from "../workers";
import { config } from "../config";
import { auditService } from "./audit";
import Analytics from "./analytics";
import prisma from "../prismaClient";

interface SystemMetrics {
  timestamp: string;
  instance: string;
  environment: string;
  cpuUsage: number;
  memoryUsage: number;
  loadAverage: number[];
  diskUsage?: number;
  dbStatus?: "healthy" | "degraded" | "unreachable";
  activeQueues: number;
  jobBacklog: Record<string, number>;
  latencyMs: number;
  uptimeMinutes: number;
}

/* -----------------------------------------------------------------------
   🧠 Core Metric Collectors
------------------------------------------------------------------------*/

/**
 * CPU and memory utilization
 */
const getSystemStats = (): { cpuUsage: number; memoryUsage: number; loadAverage: number[] } => {
  const cpus = os.cpus();
  const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const totalTick = cpus.reduce((acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
  const cpuUsage = 1 - totalIdle / totalTick;
  const memoryUsage = process.memoryUsage().rss / os.totalmem();
  const loadAverage = os.loadavg();

  return {
    cpuUsage: Number((cpuUsage * 100).toFixed(2)),
    memoryUsage: Number((memoryUsage * 100).toFixed(2)),
    loadAverage: loadAverage.map((v) => Number(v.toFixed(2))),
  };
};

/**
 * Simulate latency to detect event loop blocking
 */
const measureLatency = async (): Promise<number> => {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 10));
  return Number((performance.now() - start).toFixed(2));
};

/**
 * Estimate disk usage (percentage)
 */
const getDiskUsage = (): number => {
  try {
    const { size, free } = fs.statSync("/");
    return Number((((size - free) / size) * 100).toFixed(2));
  } catch {
    return -1;
  }
};

/**
 * Queue backlog monitoring
 */
const getQueueMetrics = async (): Promise<Record<string, number>> => {
  const result: Record<string, number> = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const count = await queue.getWaitingCount();
      result[name] = count;
    } catch {
      result[name] = -1;
    }
  }
  return result;
};

/**
 * Basic DB connectivity check
 */
const checkDatabaseHealth = async (): Promise<"healthy" | "degraded" | "unreachable"> => {
  try {
    const before = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - before;
    if (latency > 300) return "degraded";
    return "healthy";
  } catch {
    return "unreachable";
  }
};

/* -----------------------------------------------------------------------
   📊 Unified System Snapshot
------------------------------------------------------------------------*/
export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const { cpuUsage, memoryUsage, loadAverage } = getSystemStats();
  const latencyMs = await measureLatency();
  const jobBacklog = await getQueueMetrics();
  const diskUsage = getDiskUsage();
  const dbStatus = await checkDatabaseHealth();

  return {
    timestamp: new Date().toISOString(),
    instance: os.hostname(),
    environment: config.nodeEnv || "development",
    cpuUsage,
    memoryUsage,
    loadAverage,
    diskUsage,
    dbStatus,
    latencyMs,
    activeQueues: Object.keys(queues).length,
    jobBacklog,
    uptimeMinutes: Math.floor(process.uptime() / 60),
  };
};

/* -----------------------------------------------------------------------
   🚨 Intelligent Monitor + Alert System
------------------------------------------------------------------------*/
export const startSystemMonitor = (intervalMs = 60000) => {
  logger.info(`[MONITOR] 🧠 System monitor active (every ${intervalMs / 1000}s)`);

  setInterval(async () => {
    try {
      const metrics = await getSystemMetrics();
      logger.info("[MONITOR] 📊 System snapshot:", metrics);

      // High usage alerts
      if (metrics.cpuUsage > 85 || metrics.memoryUsage > 85) {
        const issue = metrics.cpuUsage > 85 ? "CPU Overload" : "Memory Pressure";
        logger.warn(`[MONITOR] ⚠️ ${issue} detected on ${metrics.instance}`);

        // Send to audit + analytics
        await auditService.log({
          actorId: "system",
          actorRole: "system",
          action: "SYSTEM_ALERT",
          details: {
            issue,
            metrics,
            environment: metrics.environment,
          },
        });

        Analytics.telemetry("system-monitor", {
          alert: issue,
          cpu: metrics.cpuUsage,
          mem: metrics.memoryUsage,
          env: metrics.environment,
        });
      }

      // Log degraded DB or high backlog
      if (metrics.dbStatus !== "healthy" || Object.values(metrics.jobBacklog).some((x) => x > 20)) {
        logger.warn("[MONITOR] ⚠️ Queue or DB degradation detected", {
          dbStatus: metrics.dbStatus,
          jobBacklog: metrics.jobBacklog,
        });
      }
    } catch (err: any) {
      logger.error("[MONITOR] ❌ System monitor error:", err.message);
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { error: err.message },
      });
    }
  }, intervalMs);
};

/* -----------------------------------------------------------------------
   🧩 (Optional) Expose for Super Admin Dashboards
------------------------------------------------------------------------*/
/**
 * Intended for secure Super Admin API route:
 * GET /admin/system/status
 */
export const getSystemStatusForAdmin = async () => {
  const metrics = await getSystemMetrics();
  return {
    status: metrics.dbStatus === "healthy" ? "OK" : "ISSUE",
    metrics,
    alerts: {
      highCPU: metrics.cpuUsage > 85,
      highMemory: metrics.memoryUsage > 85,
      degradedDB: metrics.dbStatus !== "healthy",
    },
  };
};