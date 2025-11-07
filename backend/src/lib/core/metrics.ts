/**
 * ------------------------------------------------------------------------
 * src/lib/core/metrics.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade observability metrics for Project Athlete 360.
 *
 * Features:
 *  - Prometheus counters/gauges/histograms with low cardinality
 *  - API, worker, DB, AI, and system metrics
 *  - Auto-refreshing resource gauges
 *  - TraceId correlation (OpenTelemetry)
 *  - Graceful fallback under cluster/worker models
 * ------------------------------------------------------------------------
 */

import client from "prom-client";
import os from "os";
import { context, trace } from "@opentelemetry/api";
import { logger } from "../../logger";

const PREFIX = "pa360_";
const ENV = process.env.NODE_ENV || "unknown";

/* ---------------------------------------------------------------------
   🔧 Default Metrics Registration
   ------------------------------------------------------------------- */
client.collectDefaultMetrics({
  prefix: PREFIX,
  timeout: 5000,
});

export const register = client.register;

/* ---------------------------------------------------------------------
   📊 Metric Definitions
   ------------------------------------------------------------------- */

// ─── API Metrics ─────────────────────────────────────────────
export const httpRequestDuration = new client.Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: "HTTP request latency distribution (seconds)",
  labelNames: ["method", "route", "status_code", "env"],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

export const httpRequestCount = new client.Counter({
  name: `${PREFIX}http_requests_total`,
  help: "Total number of HTTP requests handled",
  labelNames: ["method", "route", "status_code", "env"],
});

// ❌ Error rate will be derived via PromQL instead of local approximation
export const apiErrorRate = new client.Gauge({
  name: `${PREFIX}api_error_rate`,
  help: "Rolling API error ratio (computed externally via PromQL)",
  labelNames: ["route", "env"],
});

// ─── Application Errors ─────────────────────────────────────
export const errorCount = new client.Counter({
  name: `${PREFIX}error_count_total`,
  help: "Total number of application errors logged",
  labelNames: ["type", "severity", "env"],
});

// ─── Worker Metrics ─────────────────────────────────────────
export const workerJobDuration = new client.Histogram({
  name: `${PREFIX}queue_job_duration_seconds`,
  help: "Job processing duration per queue (seconds)",
  labelNames: ["queue_name", "status", "env"],
  buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60],
});

export const queueFailuresTotal = new client.Counter({
  name: `${PREFIX}queue_failures_total`,
  help: "Total number of failed jobs per queue",
  labelNames: ["queue_name", "env"],
});

// ─── Database ───────────────────────────────────────────────
export const dbConnectionGauge = new client.Gauge({
  name: `${PREFIX}db_connection_active_total`,
  help: "Number of active DB connections",
  labelNames: ["pool_name", "env"],
});

// ─── Storage ────────────────────────────────────────────────
export const storageUsageGauge = new client.Gauge({
  name: `${PREFIX}storage_usage_bytes`,
  help: "Storage usage per institution (bytes)",
  labelNames: ["institution_id", "env"],
});

// ─── Billing & Abuse ────────────────────────────────────────
export const billingOverageCount = new client.Counter({
  name: `${PREFIX}billing_overage_events_total`,
  help: "Number of billing overage events detected",
  labelNames: ["institution_id", "env"],
});

export const trialAbuseCount = new client.Counter({
  name: `${PREFIX}trial_abuse_detected_total`,
  help: "Trial-abuse flag triggers per institution",
  labelNames: ["institution_id", "env"],
});

// ─── Worker Health ──────────────────────────────────────────
export const workerHealthGauge = new client.Gauge({
  name: `${PREFIX}worker_health_status`,
  help: "Worker health status (1=healthy, 0=failed)",
  labelNames: ["worker", "env"],
});

// ─── AI Activity ────────────────────────────────────────────
export const aiActivityCount = new client.Counter({
  name: `${PREFIX}ai_activity_total`,
  help: "AI activity events processed (inference, analysis, etc.)",
  labelNames: ["type", "env"],
});

// ─── Metrics Exposure ───────────────────────────────────────
export const metricsExposeCount = new client.Counter({
  name: `${PREFIX}metrics_exposed_total`,
  help: "Number of successful /metrics endpoint scrapes",
});

/* ---------------------------------------------------------------------
   ⚙️ System Gauges (auto-updating)
   ------------------------------------------------------------------- */
const systemCpuGauge = new client.Gauge({
  name: `${PREFIX}system_cpu_load_percent`,
  help: "1-minute system CPU load (percent of total cores)",
});

const systemMemoryGauge = new client.Gauge({
  name: `${PREFIX}system_memory_usage_bytes`,
  help: "Resident memory usage in bytes",
});

setInterval(() => {
  try {
    const cpuLoad = (os.loadavg()[0] / os.cpus().length) * 100;
    const memUsage = process.memoryUsage().rss;
    systemCpuGauge.set(cpuLoad);
    systemMemoryGauge.set(memUsage);
  } catch (err) {
    logger.warn("[METRICS] Failed to collect system metrics", {
      error: (err as Error).message,
    });
  }
}, 60_000).unref();

/* ---------------------------------------------------------------------
   🧠 Recorders / Helpers
   ------------------------------------------------------------------- */

/**
 * Safely sanitize route labels to avoid high-cardinality Prometheus labels
 */
const sanitizeRoute = (route: string) =>
  route.replace(/[0-9a-fA-F-]{8,}/g, ":id").replace(/\/$/, "") || "/";

/**
 * Record HTTP request metrics with trace correlation
 */
export const recordRequestMetrics = (
  method: string,
  route: string,
  statusCode: number,
  durationSec: number
) => {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId ?? "none";
  const safeRoute = sanitizeRoute(route);

  httpRequestDuration.labels(method, safeRoute, String(statusCode), ENV).observe(durationSec);
  httpRequestCount.labels(method, safeRoute, String(statusCode), ENV).inc();

  if (statusCode >= 400) {
    errorCount.labels("http_error", "medium", ENV).inc();
  }

  logger.info({
    traceId,
    method,
    route: safeRoute,
    statusCode,
    durationSec,
    msg: "HTTP metrics recorded",
  });
};

/** Generic recorders for different domains */
export const recordError = (type: string, severity: "low" | "medium" | "high" = "medium") =>
  errorCount.labels(type, severity, ENV).inc();

export const recordWorkerJob = (
  queue: string,
  durationSec: number,
  status: "success" | "failed"
) => {
  workerJobDuration.labels(queue, status, ENV).observe(durationSec);
  if (status === "failed") queueFailuresTotal.labels(queue, ENV).inc();
};

export const recordDBConnections = (pool: string, active: number) =>
  dbConnectionGauge.labels(pool, ENV).set(active);

export const recordStorageUsage = (institutionId: string, bytes: number) =>
  storageUsageGauge.labels(institutionId, ENV).set(bytes);

export const recordBillingOverage = (institutionId: string) =>
  billingOverageCount.labels(institutionId, ENV).inc();

export const recordTrialAbuse = (institutionId: string) =>
  trialAbuseCount.labels(institutionId, ENV).inc();

export const recordAIActivity = (type: string) =>
  aiActivityCount.labels(type, ENV).inc();

export const recordWorkerHealth = (worker: string, healthy: boolean) =>
  workerHealthGauge.labels(worker, ENV).set(healthy ? 1 : 0);

/* ---------------------------------------------------------------------
   🌐 Exports
   ------------------------------------------------------------------- */
export const getMetrics = async (): Promise<string> => {
  metricsExposeCount.inc();
  return register.metrics();
};

export const getSystemSnapshot = () => ({
  uptimeSec: process.uptime(),
  memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  cpuLoadPercent: (os.loadavg()[0] / os.cpus().length) * 100,
  timestamp: new Date().toISOString(),
});

/* ---------------------------------------------------------------------
   🛡 Error Hooks
   ------------------------------------------------------------------- */
process.on("uncaughtException", (err) => {
  recordError("uncaught_exception", "high");
  logger.error("[METRICS] Uncaught exception captured", err);
});

process.on("unhandledRejection", (err: any) => {
  recordError("unhandled_rejection", "high");
  logger.error("[METRICS] Unhandled rejection captured", err);
});