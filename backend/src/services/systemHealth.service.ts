/**
 * src/services/systemHealth.service.ts
 * --------------------------------------------------------------------------
 * 🚀 Enterprise-grade System Health Service (v2.0)
 *
 * Responsibilities:
 *  - Performs deep health checks for all core subsystems:
 *    DB (Prisma), Redis/BullMQ, Workers, AI, Storage (S3), and Infra.
 *  - Aggregates status, latency, and severity with clear summaries.
 *  - Supports retries, timeouts, and threshold-based alerting.
 *  - Integrates with auditService, admin notifications, Prometheus & telemetry.
 *  - Periodic self-monitor for proactive issue detection.
 *
 * Design goals:
 *  - Non-blocking & fault-tolerant (never crashes app)
 *  - Composable: used by Super Admin API and /health endpoints
 *  - Cloud-native: ready for Kubernetes probes and CI/CD checks
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import { checkWorkerHealth } from "../workers/index";
import aiManager, { aiHealthCheck } from "../integrations/ai.bootstrap";
import { uploadToS3, headObject } from "../lib/s3";
import { addNotificationJob } from "../workers/notification.worker";
import { auditService } from "./audit.service";
import { recordError, workerJobsCount } from "../lib/core/metrics";
import { telemetry } from "../lib/telemetry";

type ComponentStatus = {
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

/* ------------------------------------------------------------------------
   🧭 Helper — Measure execution time with timeout & retry
------------------------------------------------------------------------ */
const measure = async <T>(fn: () => Promise<T>, timeoutMs = 5000, retries = 1) => {
  const start = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const p = fn();
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs)
      );
      await Promise.race([p, timeout]);
      const latency = Date.now() - start;
      return { latency, success: true };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { latency: Date.now() - start, success: false };
};

/* ------------------------------------------------------------------------
   🧱 DB Health Check (Prisma)
------------------------------------------------------------------------ */
export const checkDatabase = async (): Promise<ComponentStatus> => {
  try {
    const { latency } = await measure(async () => {
      await prisma.$queryRaw`SELECT 1`;
    }, config.health.dbTimeoutMs ?? 3000);

    telemetry.record("health.db.latency", latency);
    return { ok: true, latencyMs: latency, message: "Database reachable" };
  } catch (err: any) {
    recordError("db_health_check_failed", "critical");
    logger.error("[HEALTH] DB check failed", { error: err?.message });
    return {
      ok: false,
      message: "Database unreachable",
      severity: "critical",
      details: { error: err?.message },
    };
  }
};

/* ------------------------------------------------------------------------
   🔁 Redis / Queue Health
------------------------------------------------------------------------ */
export const checkRedisAndQueues = async (): Promise<ComponentStatus> => {
  try {
    const result = checkWorkerHealth ? await checkWorkerHealth() : { redis: "unknown" };
    const redisHealthy = result.redis === "healthy" || result.redis === "ready";
    telemetry.record("health.redis.status", redisHealthy ? 1 : 0);

    const activeWorkers = result.activeWorkers ?? 0;
    const queueNames = result.queues?.map((q: any) => q.name) ?? [];

    queueNames.forEach((name: string) =>
      workerJobsCount.labels(name).set(result.queues.find((q: any) => q.name === name)?.active || 0)
    );

    return {
      ok: redisHealthy,
      message: `Redis: ${result.redis}, Workers: ${activeWorkers}`,
      details: { redisStatus: result.redis, activeWorkers, queueNames },
      severity: redisHealthy ? "info" : "critical",
    };
  } catch (err: any) {
    recordError("redis_health_check_failed", "critical");
    logger.error("[HEALTH] Redis/Queues check failed", { error: err?.message });
    return {
      ok: false,
      message: "Redis or queue system failed",
      severity: "critical",
      details: { error: err?.message },
    };
  }
};

/* ------------------------------------------------------------------------
   ⚙️ Worker Process Health
------------------------------------------------------------------------ */
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
    logger.error("[HEALTH] Worker check failed", { error: err?.message });
    return {
      ok: false,
      message: "Worker subsystem error",
      severity: "warning",
      details: { error: err?.message },
    };
  }
};

/* ------------------------------------------------------------------------
   🧠 AI Subsystem Health
------------------------------------------------------------------------ */
export const checkAI = async (): Promise<ComponentStatus> => {
  try {
    const { latency } = await measure(async () => {
      await aiHealthCheck();
    }, 5000);

    telemetry.record("health.ai.latency", latency);
    return { ok: true, latencyMs: latency, message: "AI subsystem operational" };
  } catch (err: any) {
    recordError("ai_health_check_failed", "warning");
    logger.warn("[HEALTH] AI subsystem degraded", { error: err?.message });
    return {
      ok: false,
      message: "AI subsystem degraded",
      severity: "warning",
      details: { error: err?.message },
    };
  }
};

/* ------------------------------------------------------------------------
   ☁️ Storage Health (S3)
------------------------------------------------------------------------ */
export const checkStorage = async (): Promise<ComponentStatus> => {
  try {
    const key = config.storage.healthObjectKey || "health_probe.txt";
    const { latency } = await measure(async () => {
      await headObject(key);
    }, 3000);

    telemetry.record("health.storage.latency", latency);
    return { ok: true, latencyMs: latency, message: "S3 reachable" };
  } catch (err: any) {
    recordError("storage_health_check_failed", "critical");
    logger.error("[HEALTH] Storage unreachable", { error: err?.message });
    return {
      ok: false,
      message: "Storage unreachable",
      severity: "critical",
      details: { error: err?.message },
    };
  }
};

/* ------------------------------------------------------------------------
   📊 Aggregate Full Health Report
------------------------------------------------------------------------ */
export const runFullHealthCheck = async (): Promise<SystemHealthReport> => {
  const timestamp = new Date().toISOString();

  const results = await Promise.allSettled([
    checkDatabase(),
    checkRedisAndQueues(),
    checkWorkers(),
    checkAI(),
    checkStorage(),
  ]);

  const safe = (r: PromiseSettledResult<ComponentStatus>) =>
    r.status === "fulfilled" ? r.value : {
      ok: false,
      message: "Health check failed",
      severity: "critical",
      details: { error: (r as any).reason?.message || String((r as any).reason) },
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

  const report = { timestamp, db, redisQueues, workers, ai, storage, overall, summary };
  telemetry.record("health.overall.status", overall === "healthy" ? 1 : 0);
  logger.info("[HEALTH] Full check executed", { overall, summary });

  return report;
};

/* ------------------------------------------------------------------------
   🚨 Alert Escalation & Notifications
------------------------------------------------------------------------ */
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
    logger.error("[HEALTH] Failed to send alert", { error: err?.message });
  }
};

/* ------------------------------------------------------------------------
   ⏱️ Periodic Monitor
------------------------------------------------------------------------ */
let monitorTimer: NodeJS.Timeout | null = null;

export const startPeriodicHealthMonitor = (intervalMs = 60_000) => {
  if (monitorTimer) return logger.warn("[HEALTH] Monitor already active.");
  logger.info(`[HEALTH] 🩺 Starting periodic health monitor (${intervalMs / 1000}s)`);

  monitorTimer = setInterval(async () => {
    try {
      const report = await runFullHealthCheck();
      await evaluateAndAlert(report);
    } catch (err: any) {
      recordError("periodic_health_monitor_error", "medium");
      logger.error("[HEALTH] Periodic monitor error", { error: err?.message });
    }
  }, intervalMs);
};

export const stopPeriodicHealthMonitor = () => {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("[HEALTH] Periodic monitor stopped.");
  }
};

/* ------------------------------------------------------------------------
   ⚡ Quick Readiness Check (K8s-friendly)
------------------------------------------------------------------------ */
export const quickReadinessCheck = async (): Promise<{ ready: boolean; reason?: string }> => {
  try {
    const db = await checkDatabase();
    if (!db.ok) return { ready: false, reason: "Database not ready" };

    const redis = await checkRedisAndQueues();
    if (!redis.ok) return { ready: false, reason: "Redis not ready" };

    return { ready: true };
  } catch (err: any) {
    return { ready: false, reason: err?.message };
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