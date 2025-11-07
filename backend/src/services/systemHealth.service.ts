/**
 * src/services/systemHealth.service.ts
 * --------------------------------------------------------------------------
 * 🚀 Enterprise-grade System Health Service (v2.1)
 *
 * Responsibilities:
 *  - Performs deep health checks for all core subsystems:
 *    DB (Prisma), Redis/BullMQ, Workers, AI, Storage (S3), Infra
 *  - Aggregates status, latency, and severity with clear summaries
 *  - Supports retries, timeouts, and threshold-based alerting
 *  - Integrates with auditService, admin notifications, Prometheus & telemetry
 *  - Periodic self-monitor for proactive issue detection
 *
 * Design Goals:
 *  - Non-blocking, fault-tolerant, cloud-native
 *  - Works for Super Admin API, /health endpoints & CI probes
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import { checkWorkerHealth } from "../workers";
import { aiHealthCheck } from "../integrations/ai.bootstrap";
import { headObject } from "../lib/s3";
import { addNotificationJob } from "../workers/notification.worker";
import { auditService } from "./audit.service";
import {
  recordError,
  workerJobsCount,
  recordDBConnections,
  recordStorageUsage,
} from "../lib/core/metrics";
import { telemetry } from "../lib/telemetry";

/* --------------------------------------------------------------------------
 * ⚙️ Types
 * ------------------------------------------------------------------------ */
export type ComponentStatus = {
  ok: boolean;
  latencyMs?: number | null;
  message?: string;
  details?: Record<string, any>;
  severity?: "info" | "warning" | "critical";
};

export type SystemHealthReport = {
  timestamp: string;
  db: ComponentStatus;
  redisQueues: ComponentStatus;
  workers: ComponentStatus;
  ai: ComponentStatus;
  storage: ComponentStatus;
  overall: "healthy" | "degraded" | "unhealthy";
  summary: string;
};

/* --------------------------------------------------------------------------
 * 🧭 Helper — Execution Wrapper (timeout + retries)
 * ------------------------------------------------------------------------ */
const measure = async <T>(
  fn: () => Promise<T>,
  timeoutMs = 5000,
  retries = 1
): Promise<{ latency: number; success: boolean }> => {
  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = fn();
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs)
      );
      await Promise.race([promise, timeout]);
      return { latency: Date.now() - start, success: true };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { latency: Date.now() - start, success: false };
};

/* --------------------------------------------------------------------------
 * 🧱 Database (Prisma)
 * ------------------------------------------------------------------------ */
export const checkDatabase = async (): Promise<ComponentStatus> => {
  try {
    const { latency } = await measure(async () => {
      await prisma.$queryRaw`SELECT 1`;
    }, config.health.dbTimeoutMs ?? 3000);

    telemetry.record("health.db.latency", latency);
    recordDBConnections("primary", 1);

    return { ok: true, latencyMs: latency, message: "Database reachable" };
  } catch (err: any) {
    recordError("db_health_check_failed", "critical");
    logger.error("[HEALTH] ❌ Database check failed", { error: err.message });
    return {
      ok: false,
      message: "Database unreachable",
      severity: "critical",
      details: { error: err.message },
    };
  }
};

/* --------------------------------------------------------------------------
 * 🔁 Redis / Queue Health
 * ------------------------------------------------------------------------ */
export const checkRedisAndQueues = async (): Promise<ComponentStatus> => {
  try {
    const result = await checkWorkerHealth();
    const redisHealthy = ["healthy", "ready"].includes(result.redis);
    telemetry.record("health.redis.status", redisHealthy ? 1 : 0);

    const activeWorkers = result.activeWorkers ?? 0;
    const queueNames = result.queues?.map((q: any) => q.name) ?? [];

    queueNames.forEach((name: string) => {
      const activeCount =
        result.queues.find((q: any) => q.name === name)?.active || 0;
      workerJobsCount.labels(name).set(activeCount);
    });

    return {
      ok: redisHealthy,
      message: `Redis: ${result.redis}, Workers: ${activeWorkers}`,
      details: { redisStatus: result.redis, activeWorkers, queueNames },
      severity: redisHealthy ? "info" : "critical",
    };
  } catch (err: any) {
    recordError("redis_health_check_failed", "critical");
    logger.error("[HEALTH] ❌ Redis/Queue check failed", { error: err.message });
    return {
      ok: false,
      message: "Redis or queue subsystem failed",
      severity: "critical",
      details: { error: err.message },
    };
  }
};

/* --------------------------------------------------------------------------
 * ⚙️ Worker Process Health
 * ------------------------------------------------------------------------ */
export const checkWorkers = async (): Promise<ComponentStatus> => {
  try {
    const result = await checkWorkerHealth();
    const active = result.activeWorkers ?? 0;
    const queues = result.queues ?? [];
    const ok = active > 0 && queues.length > 0;

    telemetry.record("health.workers.active", active);

    return {
      ok,
      message: `Workers active: ${active}, queues: ${queues.length}`,
      details: { active, queues },
      severity: ok ? "info" : "warning",
    };
  } catch (err: any) {
    recordError("worker_health_check_failed", "medium");
    logger.error("[HEALTH] ⚠️ Worker health check failed", { error: err.message });
    return {
      ok: false,
      message: "Worker subsystem error",
      severity: "warning",
      details: { error: err.message },
    };
  }
};

/* --------------------------------------------------------------------------
 * 🧠 AI Subsystem Health
 * ------------------------------------------------------------------------ */
export const checkAI = async (): Promise<ComponentStatus> => {
  try {
    const { latency } = await measure(aiHealthCheck, 5000);
    telemetry.record("health.ai.latency", latency);

    return { ok: true, latencyMs: latency, message: "AI subsystem operational" };
  } catch (err: any) {
    recordError("ai_health_check_failed", "warning");
    logger.warn("[HEALTH] ⚠️ AI subsystem degraded", { error: err.message });
    return {
      ok: false,
      message: "AI subsystem degraded",
      severity: "warning",
      details: { error: err.message },
    };
  }
};

/* --------------------------------------------------------------------------
 * ☁️ Storage (S3)
 * ------------------------------------------------------------------------ */
export const checkStorage = async (): Promise<ComponentStatus> => {
  try {
    const key = config.storage.healthObjectKey || "health_probe.txt";
    const { latency } = await measure(() => headObject(key), 3000);
    telemetry.record("health.storage.latency", latency);
    recordStorageUsage("global", latency);

    return { ok: true, latencyMs: latency, message: "Storage reachable" };
  } catch (err: any) {
    recordError("storage_health_check_failed", "critical");
    logger.error("[HEALTH] ❌ Storage unreachable", { error: err.message });
    return {
      ok: false,
      message: "Storage unreachable",
      severity: "critical",
      details: { error: err.message },
    };
  }
};

/* --------------------------------------------------------------------------
 * 📊 Aggregate Full Health Report
 * ------------------------------------------------------------------------ */
export const runFullHealthCheck = async (): Promise<SystemHealthReport> => {
  const timestamp = new Date().toISOString();

  const results = await Promise.allSettled([
    checkDatabase(),
    checkRedisAndQueues(),
    checkWorkers(),
    checkAI(),
    checkStorage(),
  ]);

  const safe = (r: PromiseSettledResult<ComponentStatus>): ComponentStatus =>
    r.status === "fulfilled"
      ? r.value
      : {
          ok: false,
          message: "Health check failed",
          severity: "critical",
          details: { error: (r as any).reason?.message },
        };

  const [db, redisQueues, workers, ai, storage] = results.map(safe);
  const critical = [db, redisQueues, storage].some((c) => !c.ok);
  const warning = [workers, ai].some((c) => !c.ok);
  const overall = critical ? "unhealthy" : warning ? "degraded" : "healthy";

  const summary =
    overall === "healthy"
      ? "✅ All systems operational"
      : overall === "degraded"
      ? "⚠️ Non-critical degradation detected"
      : "🚨 Critical system failure — immediate attention required";

  telemetry.record("health.overall.status", overall === "healthy" ? 1 : 0);
  logger.info("[HEALTH] ✅ Full system health evaluated", { overall, summary });

  return { timestamp, db, redisQueues, workers, ai, storage, overall, summary };
};

/* --------------------------------------------------------------------------
 * 🚨 Alert Escalation & Notifications
 * ------------------------------------------------------------------------ */
export const evaluateAndAlert = async (report: SystemHealthReport) => {
  try {
    if (report.overall === "unhealthy") {
      const message = `🚨 Critical health issue detected: ${report.summary}`;
      await addNotificationJob({
        type: "systemAlert",
        recipientId: "super-admins",
        title: "Critical System Alert",
        body: message,
        channel: ["email", "inApp"],
        meta: { report },
      });
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { summary: report.summary, overall: report.overall },
      });
      logger.warn("[HEALTH] 🚨 Critical alert dispatched.");
    } else if (report.overall === "degraded") {
      await addNotificationJob({
        type: "systemNotice",
        recipientId: "super-admins",
        title: "System Degraded",
        body: report.summary,
        channel: ["inApp"],
      });
    }
  } catch (err: any) {
    recordError("health_alert_dispatch_failed", "medium");
    logger.error("[HEALTH] ⚠️ Failed to send health alert", { error: err.message });
  }
};

/* --------------------------------------------------------------------------
 * ⏱️ Periodic Health Monitor (Self-Check)
 * ------------------------------------------------------------------------ */
let monitorTimer: NodeJS.Timeout | null = null;

export const startPeriodicHealthMonitor = (intervalMs = 60_000) => {
  if (monitorTimer) return logger.warn("[HEALTH] Monitor already running.");
  logger.info(`[HEALTH] 🩺 Starting periodic monitor every ${intervalMs / 1000}s`);

  monitorTimer = setInterval(async () => {
    try {
      const report = await runFullHealthCheck();
      await evaluateAndAlert(report);
    } catch (err: any) {
      recordError("periodic_health_monitor_error", "medium");
      logger.error("[HEALTH] Periodic monitor error", { error: err.message });
    }
  }, intervalMs);
};

export const stopPeriodicHealthMonitor = () => {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("[HEALTH] 🛑 Periodic monitor stopped.");
  }
};

/* --------------------------------------------------------------------------
 * ⚡ Quick Readiness Check (for Kubernetes / CI)
 * ------------------------------------------------------------------------ */
export const quickReadinessCheck = async (): Promise<{ ready: boolean; reason?: string }> => {
  try {
    const db = await checkDatabase();
    if (!db.ok) return { ready: false, reason: "Database not ready" };

    const redis = await checkRedisAndQueues();
    if (!redis.ok) return { ready: false, reason: "Redis not ready" };

    return { ready: true };
  } catch (err: any) {
    return { ready: false, reason: err.message };
  }
};

export default {
  checkDatabase,
  checkRedisAndQueues,
  checkWorkers,
  checkAI,
  checkStorage,
  runFullHealthCheck,
  evaluateAndAlert,
  startPeriodicHealthMonitor,
  stopPeriodicHealthMonitor,
  quickReadinessCheck,
};