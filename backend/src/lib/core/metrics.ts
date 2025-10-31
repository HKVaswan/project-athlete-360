/**
 * src/lib/core/metrics.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade metrics collection and monitoring utility.
 *
 * Tracks:
 *  - Request performance (latency, errors, throughput)
 *  - API-level usage (per role or endpoint)
 *  - Worker queue stats
 *  - AI prediction activity
 *  - System resource usage (CPU, memory)
 *
 * Exposes Prometheus-compatible metrics for Grafana dashboards.
 */

import client from "prom-client";
import os from "os";
import { logger } from "../../logger";

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: "pa360_", timeout: 5000 }); // prefix for consistency

// ──────────────────────────────────────────────
// 🧭 Custom Metrics
// ──────────────────────────────────────────────

// API Request Duration Histogram
export const httpRequestDuration = new client.Histogram({
  name: "pa360_http_request_duration_seconds",
  help: "HTTP request latency distribution",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

// API Request Count Counter
export const httpRequestCount = new client.Counter({
  name: "pa360_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

// Error Counter
export const errorCount = new client.Counter({
  name: "pa360_error_count_total",
  help: "Total number of errors logged",
  labelNames: ["type", "severity"],
});

// Worker Queue Jobs Counter
export const workerJobsCount = new client.Gauge({
  name: "pa360_worker_jobs_active",
  help: "Number of active jobs per queue",
  labelNames: ["queue_name"],
});

// AI Activity Counter
export const aiActivityCount = new client.Counter({
  name: "pa360_ai_activity_total",
  help: "Number of AI-related events processed",
  labelNames: ["type"],
});

// ──────────────────────────────────────────────
// 🧠 Helper Functions
// ──────────────────────────────────────────────

export const recordRequestMetrics = (
  method: string,
  route: string,
  statusCode: number,
  durationSec: number
) => {
  httpRequestDuration.labels(method, route, String(statusCode)).observe(durationSec);
  httpRequestCount.labels(method, route, String(statusCode)).inc();
};

export const recordError = (type: string, severity: "low" | "medium" | "high" = "medium") => {
  errorCount.labels(type, severity).inc();
};

export const recordAIActivity = (type: string) => {
  aiActivityCount.labels(type).inc();
};

export const recordWorkerJobs = (queueName: string, activeJobs: number) => {
  workerJobsCount.labels(queueName).set(activeJobs);
};

// ──────────────────────────────────────────────
// 🌐 Metrics Endpoint Helper
// ──────────────────────────────────────────────

export const getMetrics = async () => {
  return await client.register.metrics();
};

// ──────────────────────────────────────────────
// ⚙️ Resource Snapshot Utility
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// 🔒 Graceful Error Handling
// ──────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  recordError("uncaught_exception", "high");
  logger.error("[METRICS] Uncaught exception captured:", err);
});

process.on("unhandledRejection", (err: any) => {
  recordError("unhandled_rejection", "high");
  logger.error("[METRICS] Unhandled rejection captured:", err);
});

// ──────────────────────────────────────────────
// 🧩 Example Express Integration (Optional)
//
// import express from "express";
// import { getMetrics } from "../lib/core/metrics";
// const router = express.Router();
// router.get("/metrics", async (_, res) => {
//   res.set("Content-Type", client.register.contentType);
//   res.send(await getMetrics());
// });
// app.use("/metrics", router);
// ──────────────────────────────────────────────