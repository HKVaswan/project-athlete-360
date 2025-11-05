/**
 * src/lib/core/metrics.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade observability metrics for Project Athlete 360.
 *
 * Features:
 *  - Prometheus counters/gauges/histograms with sane cardinality
 *  - API, worker, DB, and system metrics
 *  - Auto-refreshing system resource gauges
 *  - TraceId correlation for logs and traces (OpenTelemetry)
 *  - Safe under clustering or concurrent worker models
 * ------------------------------------------------------------------------
 */

import client from "prom-client";
import os from "os";
import { logger } from "../../logger";
import { context, trace } from "@opentelemetry/api";

const PREFIX = "pa360_";

/* ---------------------------------------------------------------------
   🔧 Default Metrics
   ------------------------------------------------------------------- */
client.collectDefaultMetrics({
  prefix: PREFIX,
  timeout: 5000,
});

export const register = client.register;

/* ---------------------------------------------------------------------
   📈 Custom Metrics Definitions
   ------------------------------------------------------------------- */

// API request metrics
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

export const errorCount = new client.Counter({
  name: `${PREFIX}error_count_total`,
  help: "Number of application errors logged",
  labelNames: ["type", "severity", "env"],
});

export const workerJobDuration = new client.Histogram({
  name: `${PREFIX}worker_job_duration_seconds`,
  help: "Histogram of job processing duration per queue",
  labelNames: ["queue_name", "status", "env"],
  buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60],
});

export const dbConnectionGauge = new client.Gauge({
  name: `${PREFIX}db_connections_active`,
  help: "Active database connections",
  labelNames: ["pool_name", "env"],
});

export const storageUsageGauge = new client.Gauge({
  name: `${PREFIX}storage_usage_bytes`,
  help: "Storage usage per institution",
  labelNames: ["institution_id", "env"],
});

export const trialAbuseCount = new client.Counter({
  name: `${PREFIX}trial_abuse_detected_total`,
  help: "Trial abuse detection events",
  labelNames: ["institution_id", "env"],
});

export const aiActivityCount = new client.Counter({
  name: `${PREFIX}ai_activity_total`,
  help: "AI events processed (inference, training, etc.)",
  labelNames: ["type", "env"],
});

/* ---------------------------------------------------------------------
   ⚙️ System Resource Metrics
   ------------------------------------------------------------------- */
const systemCpuGauge = new client.Gauge({
  name: `${PREFIX}system_cpu_load`,
  help: "1-min CPU load average",
});

const systemMemoryGauge = new client.Gauge({
  name: `${PREFIX}system_memory_usage_bytes`,
  help: "Resident memory usage (bytes)",
});

setInterval(() => {
  const cpu = os.loadavg()[0];
  const mem = process.memoryUsage().rss;
  systemCpuGauge.set(cpu);
  systemMemoryGauge.set(mem);
}, 60_000).unref();

/* ---------------------------------------------------------------------
   🧠 Helper Functions
   ------------------------------------------------------------------- */

/**
 * Records HTTP metrics with trace correlation.
 */
export const recordRequestMetrics = (
  method: string,
  route: string,
  statusCode: number,
  durationSec: number
) => {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId ?? "none";
  const env = process.env.NODE_ENV || "unknown";

  httpRequestDuration.labels(method, route, String(statusCode), env).observe(durationSec);
  httpRequestCount.labels(method, route, String(statusCode), env).inc();

  logger.debug({
    traceId,
    method,
    route,
    statusCode,
    durationSec,
    msg: "Request metrics recorded",
  });
};

/**
 * Records system/application errors for alerting.
 */
export const recordError = (
  type: string,
  severity: "low" | "medium" | "high" = "medium"
) => {
  const env = process.env.NODE_ENV || "unknown";
  errorCount.labels(type, severity, env).inc();
};

/**
 * Records queue/job metrics for worker systems.
 */
export const recordWorkerJob = (
  queue: string,
  durationSec: number,
  status: "success" | "failed"
) => {
  const env = process.env.NODE_ENV || "unknown";
  workerJobDuration.labels(queue, status, env).observe(durationSec);
};

/**
 * Records active database connections.
 */
export const recordDBConnections = (poolName: string, active: number) => {
  const env = process.env.NODE_ENV || "unknown";
  dbConnectionGauge.labels(poolName, env).set(active);
};

/**
 * Records per-institution storage usage.
 */
export const recordStorageUsage = (institutionId: string, bytes: number) => {
  const env = process.env.NODE_ENV || "unknown";
  storageUsageGauge.labels(institutionId, env).set(bytes);
};

/**
 * Records AI activity events.
 */
export const recordAIActivity = (type: string) => {
  const env = process.env.NODE_ENV || "unknown";
  aiActivityCount.labels(type, env).inc();
};

/**
 * Records trial abuse detections.
 */
export const recordTrialAbuse = (institutionId: string) => {
  const env = process.env.NODE_ENV || "unknown";
  trialAbuseCount.labels(institutionId, env).inc();
};

/* ---------------------------------------------------------------------
   🌐 Expose Metrics & System Snapshot
   ------------------------------------------------------------------- */
export const getMetrics = async (): Promise<string> => {
  return await register.metrics();
};

export const getSystemSnapshot = () => {
  const memoryUsage = process.memoryUsage();
  const cpuLoad = os.loadavg()[0];
  return {
    uptimeSec: process.uptime(),
    memoryMB: Math.round(memoryUsage.rss / 1024 / 1024),
    cpuLoad,
    timestamp: new Date().toISOString(),
  };
};

/* ---------------------------------------------------------------------
   🧩 Error Handling Hooks
   ------------------------------------------------------------------- */
process.on("uncaughtException", (err) => {
  recordError("uncaught_exception", "high");
  logger.error("[METRICS] Uncaught exception captured", err);
});

process.on("unhandledRejection", (err: any) => {
  recordError("unhandled_rejection", "high");
  logger.error("[METRICS] Unhandled rejection captured", err);
});