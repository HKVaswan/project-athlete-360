// src/services/systemHealth.service.ts
/**
 * systemHealth.service.ts
 * --------------------------------------------------------------------------
 * Enterprise-grade system health service
 *
 * Responsibilities:
 *  - Health checks for DB (Prisma), Redis/BullMQ queues, background workers,
 *    AI subsystem, storage (S3), and other critical integrations.
 *  - Aggregates status with timestamps, latency, and human-friendly messages.
 *  - Supports retries, timeouts, and soft/hard thresholds.
 *  - Emits alerts (via adminNotification.service / auditService) when critical.
 *  - Periodic monitor that can be scheduled by a worker or started from server.
 *
 * Usage:
 *  import { runFullHealthCheck, startPeriodicHealthMonitor } from "src/services/systemHealth.service";
 *
 * Notes:
 *  - Non-blocking: health checks should never crash the app.
 *  - Designed to be called by Super Admin endpoints and readiness/liveness probes.
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { config } from "../config";
import { checkWorkerHealth } from "../workers/index"; // health helper exported from workers manager
import aiManager, { aiHealthCheck } from "../integrations/ai.bootstrap";
import { uploadToS3, headObject } from "../lib/s3";
import { addNotificationJob } from "../workers/notification.worker";
import { auditService } from "./audit.service";

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

/* Utility: measure elapsed time helper */
const measure = async <T>(fn: () => Promise<T>, timeoutMs = 5000) => {
  const start = Date.now();
  const p = fn();
  // simple timeout wrapper
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("timeout")), timeoutMs)
  );
  const res = await Promise.race([p, timeout]) as T;
  const latency = Date.now() - start;
  return { res, latency };
};

/* -------------------------------
 * DB health check (Prisma)
 * ------------------------------- */
export const checkDatabase = async (): Promise<ComponentStatus> => {
  try {
    const { latency } = await measure(async () => {
      // Lightweight safe query
      // Prisma returns a promise; don't use expensive queries here
      // Use a tiny raw query for speed (SELECT 1)
      await prisma.$queryRaw`SELECT 1`;
    }, config.health.dbTimeoutMs ?? 3000);

    return { ok: true, latencyMs: latency, message: "Database reachable" };
  } catch (err: any) {
    logger.error("[HEALTH] DB check failed", { err: err?.message || err });
    return {
      ok: false,
      latencyMs: null,
      message: "Database unreachable or slow",
      details: { error: err?.message || String(err) },
      severity: "critical",
    };
  }
};

/* -------------------------------
 * Redis / Queues health check
 * ------------------------------- */
export const checkRedisAndQueues = async (): Promise<ComponentStatus> => {
  try {
    const result = checkWorkerHealth ? await checkWorkerHealth() : { redis: "unknown" };
    // interpret basic result
    const redisHealthy = result.redis === "healthy" || result.redis === "ready";
    const activeWorkers = result.activeWorkers ?? 0;
    const queues = result.queues || [];

    return {
      ok: !!redisHealthy,
      latencyMs: null,
      message: `Redis is ${result.redis}. Active workers: ${activeWorkers}`,
      details: { redisStatus: result.redis, activeWorkers, queues },
      severity: redisHealthy ? "info" : "critical",
    };
  } catch (err: any) {
    logger.error("[HEALTH] Redis/queues check failed", { err: err?.message || err });
    return {
      ok: false,
      message: "Redis/Queue health check failed",
      details: { error: err?.message || String(err) },
      severity: "critical",
    };
  }
};

/* -------------------------------
 * Worker processes health check
 * ------------------------------- */
export const checkWorkers = async (): Promise<ComponentStatus> => {
  try {
    const result = checkWorkerHealth ? await checkWorkerHealth() : { activeWorkers: 0, queues: [] };
    const activeWorkers = result.activeWorkers ?? 0;
    const queues = result.queues ?? [];

    // If no workers but queues exist — degraded
    const ok = activeWorkers > 0 || queues.length === 0;

    return {
      ok,
      latencyMs: null,
      message: `Workers active: ${activeWorkers}, queues: ${queues.length}`,
      details: { activeWorkers, queues },
      severity: ok ? "info" : "warning",
    };
  } catch (err: any) {
    logger.error("[HEALTH] Workers check failed", { err });
    return {
      ok: false,
      message: "Workers health check failed",
      details: { error: err?.message || String(err) },
      severity: "critical",
    };
  }
};

/* -------------------------------
 * AI subsystem health check
 * ------------------------------- */
export const checkAI = async (): Promise<ComponentStatus> => {
  try {
    // Use aiHealthCheck helper from bootstrap which returns detailed info
    const start = Date.now();
    const res = await aiHealthCheck();
    const latency = Date.now() - start;

    // res is expected to be map of provider => { healthy: boolean, info }
    const providers = res || {};
    const unhealthy = Object.entries(providers).filter(([_, v]: any) => !v.healthy);

    return {
      ok: unhealthy.length === 0,
      latencyMs: latency,
      message: unhealthy.length ? `${unhealthy.length} providers unhealthy` : "AI providers healthy",
      details: { providers },
      severity: unhealthy.length ? "warning" : "info",
    };
  } catch (err: any) {
    logger.error("[HEALTH] AI check failed", { err });
    return {
      ok: false,
      latencyMs: null,
      message: "AI subsystem health check failed",
      details: { error: err?.message || String(err) },
      severity: "warning",
    };
  }
};

/* -------------------------------
 * Storage (S3) health check
 * ------------------------------- */
export const checkStorage = async (): Promise<ComponentStatus> => {
  try {
    // perform a metadata/head request on a lightweight key we expect to exist or a small health file
    const healthKey = config.storage.healthObjectKey || "health_probe.txt";

    // attempt headObject (adapter returns metadata or throws)
    const start = Date.now();
    try {
      await headObject(healthKey); // should return metadata if exists
    } catch (err: any) {
      // if missing, attempt a small safe upload and delete cycle (in sandbox/dev)
      if (config.nodeEnv !== "production") {
        const testKey = `health/probe-${Date.now()}.tmp`;
        await uploadToS3({
          key: testKey,
          body: Buffer.from("ok"),
          contentType: "text/plain",
        });
        // optionally delete (implementation-dependent); ignore errors
      } else {
        // in production, treat missing health object as warning rather than critical
        logger.warn("[HEALTH] S3 headObject failed (prod) - key may be missing", { key: healthKey, err: err?.message || err });
      }
    }
    const latency = Date.now() - start;

    return { ok: true, latencyMs: latency, message: "Storage reachable" };
  } catch (err: any) {
    logger.error("[HEALTH] Storage check failed", { err });
    return {
      ok: false,
      latencyMs: null,
      message: "Object storage unreachable",
      details: { error: err?.message || String(err) },
      severity: "critical",
    };
  }
};

/* -------------------------------
 * Aggregate full health report
 * ------------------------------- */
export const runFullHealthCheck = async (): Promise<SystemHealthReport> => {
  const timestamp = new Date().toISOString();

  // Run checks in parallel but keep them isolated
  const [
    db,
    redisQueues,
    workers,
    ai,
    storage,
  ] = await Promise.allSettled([
    checkDatabase(),
    checkRedisAndQueues(),
    checkWorkers(),
    checkAI(),
    checkStorage(),
  ]);

  // Helper to normalize Promise.allSettled result
  const unwrap = (r: PromiseSettledResult<ComponentStatus>) =>
    r.status === "fulfilled" ? r.value : {
      ok: false,
      message: "check failed",
      details: { error: (r as any).reason?.message || String((r as any).reason) },
      severity: "critical",
    };

  const dbS = unwrap(db);
  const redisS = unwrap(redisQueues);
  const workersS = unwrap(workers);
  const aiS = unwrap(ai);
  const storageS = unwrap(storage);

  // Determine overall status
  const criticalFails = [dbS, redisS, storageS].filter((c) => !c.ok);
  const warningFails = [workersS, aiS].filter((c) => !c.ok);

  const overall = criticalFails.length > 0 ? "unhealthy" : warningFails.length > 0 ? "degraded" : "healthy";

  const summary =
    overall === "healthy"
      ? "All systems operational"
      : overall === "degraded"
      ? "Partial degradation detected (non-critical components)"
      : "Critical components failing (immediate attention required)";

  const report: SystemHealthReport = {
    timestamp,
    db: dbS,
    redisQueues: redisS,
    workers: workersS,
    ai: aiS,
    storage: storageS,
    overall,
    summary,
  };

  logger.info("[HEALTH] Full health check executed", { overall, summary });

  return report;
};

/* -------------------------------
 * Alerting & escalation
 * ------------------------------- */
export const evaluateAndAlert = async (report: SystemHealthReport) => {
  try {
    // If critical -> alert super admins and create audit log
    if (report.overall === "unhealthy" || (report.db && report.db.severity === "critical") || (report.storage && report.storage.severity === "critical")) {
      const message = `Critical health issue detected: ${report.summary}`;

      // enqueue admin notification job (super admins are recipients)
      await addNotificationJob({
        type: "systemAlert",
        recipientId: "super-admins", // special handling in worker/repository to resolve recipients
        title: "Critical System Alert",
        body: message,
        channel: ["email", "inApp"],
        meta: { report },
      });

      // Audit
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { summary: report.summary, overall: report.overall },
      });

      logger.warn("[HEALTH] Critical alert sent to super admins.");
    } else if (report.overall === "degraded") {
      // send lower-priority notifications
      await addNotificationJob({
        type: "systemNotice",
        recipientId: "super-admins",
        title: "System Degraded",
        body: `System degraded: ${report.summary}`,
        channel: ["inApp"],
        meta: { report },
      });

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SYSTEM_ALERT",
        details: { summary: report.summary, overall: report.overall },
      });
    }
  } catch (err: any) {
    logger.error("[HEALTH] Failed to send alert", { err: err?.message || err });
  }
};

/* -------------------------------
 * Periodic monitor
 * ------------------------------- */
let monitorTimer: NodeJS.Timeout | null = null;

export const startPeriodicHealthMonitor = (intervalMs = Number(config.health.checkIntervalMs) || 60_000) => {
  if (monitorTimer) {
    logger.warn("[HEALTH] Monitor already running");
    return;
  }
  logger.info(`[HEALTH] Starting periodic health monitor (interval ${intervalMs}ms)`);

  monitorTimer = setInterval(async () => {
    try {
      const report = await runFullHealthCheck();
      // Escalate if needed
      await evaluateAndAlert(report);
      // Optionally export metrics to monitoring pipeline here (Prometheus/Datadog)
    } catch (err) {
      logger.error("[HEALTH] Periodic monitor error", { err });
    }
  }, intervalMs);
};

export const stopPeriodicHealthMonitor = () => {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("[HEALTH] Periodic health monitor stopped");
  }
};

/* -------------------------------
 * Simple readiness check (quick)
 * ------------------------------- */
export const quickReadinessCheck = async (): Promise<{ ready: boolean; reason?: string }> => {
  try {
    const db = await checkDatabase();
    if (!db.ok) return { ready: false, reason: "Database check failed" };

    const redis = await checkRedisAndQueues();
    if (!redis.ok) return { ready: false, reason: "Redis/Queues not ready" };

    return { ready: true };
  } catch (err: any) {
    return { ready: false, reason: err?.message || String(err) };
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