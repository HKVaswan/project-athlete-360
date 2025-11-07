/**
 * tools/observability/emit_test_metrics.js
 * --------------------------------------------------------------------------
 * 🧪 Observability Test Emitter (Developer Utility)
 *
 * Purpose:
 *  - Emits synthetic Prometheus & OpenTelemetry metrics for testing.
 *  - Simulates API, worker, DB, and AI subsystem activity.
 *  - Helps validate dashboards, alerts, and metric collection pipelines.
 *  - Safe for local and staging environments (non-production only).
 *
 * Usage:
 *   node tools/observability/emit_test_metrics.js
 *
 * --------------------------------------------------------------------------
 */

import os from "os";
import { setTimeout as sleep } from "timers/promises";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import client from "prom-client";

// ─────────────────────────────────────────────────────────────────────────────
// 🧩 Environment Safety Check
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  console.error("❌ This tool must not be run in production!");
  process.exit(1);
}

console.log("🧠 Starting Observability Test Metric Emitter...");
console.log(`📍 Host: ${os.hostname()} | Env: ${process.env.NODE_ENV || "development"}`);

// ─────────────────────────────────────────────────────────────────────────────
// 🧱 Prometheus Setup
// ─────────────────────────────────────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestCount = new client.Counter({
  name: "pa360_http_requests_total",
  help: "Total HTTP requests simulated",
  labelNames: ["method", "route", "status"],
});

const jobDuration = new client.Histogram({
  name: "pa360_worker_job_duration_seconds",
  help: "Simulated worker job durations",
  labelNames: ["queue", "status"],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const cpuUsageGauge = new client.Gauge({
  name: "pa360_system_cpu_usage_percent",
  help: "Simulated CPU usage for local test",
});

const memUsageGauge = new client.Gauge({
  name: "pa360_system_memory_usage_percent",
  help: "Simulated memory usage for local test",
});

register.registerMetric(httpRequestCount);
register.registerMetric(jobDuration);
register.registerMetric(cpuUsageGauge);
register.registerMetric(memUsageGauge);

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 OpenTelemetry (Console Exporter)
// ─────────────────────────────────────────────────────────────────────────────
const meterProvider = new MeterProvider();
const exporter = new ConsoleMetricExporter();
meterProvider.addMetricReader(
  new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 10_000,
  })
);

const meter = meterProvider.getMeter("pa360-test-meter");
const otelLatency = meter.createHistogram("pa360_otel_simulated_latency_ms", {
  description: "Simulated request latency metric for OTEL test",
});

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 Emit Synthetic Metrics Loop
// ─────────────────────────────────────────────────────────────────────────────
async function emitMetrics() {
  const routes = ["/login", "/register", "/api/athletes", "/api/performance"];
  const queues = ["email", "analytics", "aiProcessing"];

  while (true) {
    // 1️⃣ Simulate HTTP requests
    const route = routes[Math.floor(Math.random() * routes.length)];
    const method = ["GET", "POST", "PUT"][Math.floor(Math.random() * 3)];
    const status = [200, 201, 400, 500][Math.floor(Math.random() * 4)];
    httpRequestCount.inc({ method, route, status });

    // 2️⃣ Simulate worker jobs
    const queue = queues[Math.floor(Math.random() * queues.length)];
    const duration = Math.random() * 3 + 0.2; // seconds
    const jobStatus = Math.random() > 0.9 ? "failed" : "success";
    jobDuration.observe({ queue, status: jobStatus }, duration);

    // 3️⃣ Simulate system usage
    const cpu = 40 + Math.random() * 50;
    const mem = 30 + Math.random() * 60;
    cpuUsageGauge.set(cpu);
    memUsageGauge.set(mem);

    // 4️⃣ Emit OpenTelemetry latency
    const latency = 50 + Math.random() * 400;
    otelLatency.record(latency);

    // 5️⃣ Log periodically
    console.log(
      `📊 Metrics emitted → route=${route}, queue=${queue}, CPU=${cpu.toFixed(
        1
      )}%, MEM=${mem.toFixed(1)}%`
    );

    await sleep(3000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 💾 Local Prometheus exposition server
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
const app = express();

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const port = process.env.METRICS_PORT || 9500;
app.listen(port, () =>
  console.log(`📡 Prometheus metrics available at → http://localhost:${port}/metrics`)
);

// ─────────────────────────────────────────────────────────────────────────────
// 🧠 Run main emitter
// ─────────────────────────────────────────────────────────────────────────────
emitMetrics().catch((err) => {
  console.error("❌ Emitter crashed:", err);
  process.exit(1);
});