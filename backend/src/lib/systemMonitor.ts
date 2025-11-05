/**
 * src/lib/systemMonitor.ts
 * -------------------------------------------------------------------------
 * Enterprise System Monitor (Enhanced)
 *
 * Features:
 *  - Real-time CPU, memory, disk, and DB performance tracking
 *  - Queue backlog and event loop latency monitoring
 *  - Prometheus metric updates for Grafana dashboards
 *  - Trace correlation via OpenTelemetry (traceId propagation)
 *  - Smart alert throttling to avoid notification spam
 * -------------------------------------------------------------------------
 */

import os from "os";
import fs from "fs";
import { performance } from "perf_hooks";
import { context, trace } from "@opentelemetry/api";
import { logger } from "../logger";
import { queues } from "../workers";
import { config } from "../config";
import { auditService } from "./audit";
import Analytics from "./analytics";
import prisma from "../prismaClient";
import {
  recordError,
  recordWorkerJob,
  recordDBConnections,
  recordStorageUsage,
} from "./core/metrics";

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
   🧠 Core Collectors
------------------------------------------------------------------------*/

/**
 * CPU & Memory Utilization
 */
const getSystemStats = (): { cpuUsage: number; memoryUsage: number; loadAverage: number[] } => {
  const loadAverage = os.loadavg();
  const totalMem = os.totalmem();
  const usedMem = process.memoryUsage().rss;
  const memoryUsage = Number(((usedMem / totalMem) * 100).toFixed(2));

  // Use load average for approximate CPU usage
  const cpuUsage = Number((Math.min((loadAverage[0] / os.cpus().length) * 100, 100)).toFixed(2));

  return { cpuUsage, memoryUsage, loadAverage };
};

/**
 * Event loop latency measurement
 */
const measureLatency = async (): Promise<number> => {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 10));
  return Number((performance.now() - start).toFixed(2));
};

/**
 * Disk Usage %
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
 * Queue Backlog
 */
const getQueueMetrics = async (): Promise<Record<string, number>> => {
  const result: Record<string, number> = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      result[name] = await queue.getWaitingCount();
    } catch {
      result[name] = -1;
    }
  }
  return result;
};

/**
 * Database Health Check
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
   📊 Unified Metrics Snapshot
------------------------------------------------------------------------*/
export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const { cpuUsage, memoryUsage, loadAverage } = getSystemStats();
  const latencyMs = await measureLatency();
  const jobBacklog = await getQueueMetrics();
  const diskUsage = getDiskUsage();
  const dbStatus = await checkDatabaseHealth();

  // Record metrics to Prometheus exporters
  recordDBConnections("primary", 1);
  recordStorageUsage("global", memoryUsage * 1024 * 1024);
  if (cpuUsage > 90 || memoryUsage > 90) recordError("high_resource_usage", "high");

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
   🚨 Smart Monitor & Alert Engine
------------------------------------------------------------------------*/

let lastAlertTime = 0;

export const startSystemMonitor = (intervalMs = 60000) => {
  logger.info(`[MONITOR] 🧠 System monitor active (every ${intervalMs / 1000}s)`);

  const run = async () => {
    try {
      const metrics = await getSystemMetrics();
      logger.info("[MONITOR] 📊 Snapshot:", metrics);

      const now = Date.now();
      const traceId = trace.getSpan(context.active())?.spanContext().traceId || "none";

      // High resource usage alert
      if (metrics.cpuUsage > 85 || metrics.memoryUsage > 85) {
        const issue = metrics.cpuUsage > 85 ? "CPU Overload" : "Memory Pressure";
        const severity = metrics.cpuUsage > 95 || metrics.memoryUsage > 95 ? "critical" : "warning";

        if (now - lastAlertTime > 5 * 60 * 1000) {
          lastAlertTime = now;
          logger.warn(`[MONITOR] ⚠️ ${issue} detected`, { traceId, severity });

          await auditService.log({
            actorId: "system",
            actorRole: "system",
            action: "SYSTEM_ALERT",
            details: { issue, severity, metrics, traceId },
          });

          Analytics.telemetry("system-monitor", {
            alert: issue,
            cpu: metrics.cpuUsage,
            mem: metrics.memoryUsage,
            severity,
            traceId,
          });
        }
      }

      // Worker or DB degradation alerts
      const queueOverload = Object.values(metrics.jobBacklog).some((x) => x > 25);
      if (metrics.dbStatus !== "healthy" || queueOverload) {
        recordError("system_degradation", "medium");
        logger.warn("[MONITOR] ⚠️ Degradation detected", {
          dbStatus: metrics.dbStatus,
          queueOverload,
          traceId,
        });
      }
    } catch (err: any) {
      recordError("system_monitor_failure", "high");
      logger.error("[MONITOR] ❌ System monitor failure:", err.message);

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { error: err.message },
      });
    }
  };

  setInterval(run, intervalMs).unref();
};

/* -----------------------------------------------------------------------
   🧩 Expose Snapshot for Super Admin Dashboard
------------------------------------------------------------------------*/
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