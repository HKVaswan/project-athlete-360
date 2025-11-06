/**
 * src/lib/telemetry.ts
 * --------------------------------------------------------------------------
 * 🌐 Enterprise Telemetry Layer
 *
 * Purpose:
 *  - Centralized metric + trace capture for the backend.
 *  - Dual-mode: standalone (internal metrics) or integrated with OpenTelemetry.
 *  - Tracks key system indicators: latency, errors, throughput, and queue health.
 *  - Supports async-safe batching, high-precision timers, and service labeling.
 *  - Exports metrics periodically to console, OTel, or analytics pipeline.
 *
 * Design Goals:
 *  - Minimal performance overhead.
 *  - No-crash guarantee — telemetry never breaks business logic.
 *  - Graceful degradation if exporters (e.g., OTLP, Prometheus) are unavailable.
 */

import os from "os";
import { performance } from "perf_hooks";
import EventEmitter from "events";
import { logger } from "../logger";
import { config } from "../config";
import { trace } from "@opentelemetry/api";
import { observabilityConfig } from "../config/observabilityConfig";
import { otelHealthCheck } from "../integrations/otel.bootstrap";

type MetricType = "counter" | "gauge" | "histogram" | "timer";

export interface Metric {
  name: string;
  value: number;
  type: MetricType;
  labels?: Record<string, string>;
  timestamp: number;
}

export interface TelemetryOptions {
  flushIntervalMs?: number;
  maxBufferSize?: number;
  enableOtelIntegration?: boolean;
}

class Telemetry extends EventEmitter {
  private buffer: Metric[] = [];
  private lastFlush = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly opts: TelemetryOptions;
  private readonly tracer = trace.getTracer(observabilityConfig.serviceName);

  constructor(opts: TelemetryOptions = {}) {
    super();
    this.opts = {
      flushIntervalMs: opts.flushIntervalMs ?? 15_000,
      maxBufferSize: opts.maxBufferSize ?? 500,
      enableOtelIntegration: opts.enableOtelIntegration ?? true,
    };

    this.startAutoFlush();
    logger.info("[Telemetry] ✅ Initialized core telemetry engine");
  }

  /* ------------------------------------------------------------------------
     🧠 Core API
  ------------------------------------------------------------------------ */

  /**
   * Record any numeric metric (safe + async)
   */
  record(name: string, value: number, type: MetricType = "gauge", labels?: Record<string, string>) {
    try {
      const metric: Metric = {
        name,
        value,
        type,
        labels,
        timestamp: Date.now(),
      };
      this.buffer.push(metric);

      // trigger flush if buffer too large
      if (this.buffer.length >= (this.opts.maxBufferSize ?? 500)) this.flush();
    } catch (err: any) {
      logger.error("[Telemetry] Failed to record metric", { error: err.message });
    }
  }

  /**
   * Measure execution time of async functions (auto-records timer metric)
   */
  async time<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.record(name, duration, "timer", labels);
      return result;
    } catch (err: any) {
      const duration = performance.now() - start;
      this.record(`${name}.error`, duration, "timer", { ...labels, error: "true" });
      throw err;
    }
  }

  /**
   * Start auto-flushing buffer every X ms
   */
  startAutoFlush() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.opts.flushIntervalMs);
  }

  /**
   * Flush buffered metrics (to logs, event bus, or external collector)
   */
  async flush() {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];

    const count = batch.length;
    const intervalSec = ((Date.now() - this.lastFlush) / 1000).toFixed(1);
    this.lastFlush = Date.now();

    try {
      logger.info(`[Telemetry] 📊 Flushing ${count} metrics (interval ${intervalSec}s)`);

      // Log detailed metrics only in debug/dev
      if (config.NODE_ENV !== "production") {
        batch.forEach((m) =>
          logger.debug(`[Metric] ${m.name}=${m.value}`, {
            labels: m.labels,
            type: m.type,
          })
        );
      }

      // Emit event (useful for internal or external exporters)
      this.emit("flush", batch);

      // Optional: Export to OpenTelemetry
      if (this.opts.enableOtelIntegration) {
        const { healthy } = await otelHealthCheck();
        if (healthy) {
          const span = this.tracer.startSpan("telemetry.flush");
          span.setAttribute("metrics.flushed", count);
          span.setAttribute("metrics.interval", Number(intervalSec));
          span.end();
        }
      }
    } catch (err: any) {
      logger.error("[Telemetry] ❌ Flush failed", { error: err.message });
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    logger.info("[Telemetry] 🧹 Shutdown complete");
  }

  /* ------------------------------------------------------------------------
     📦 System Snapshot (for Admin Dashboard)
  ------------------------------------------------------------------------ */
  snapshot() {
    const mem = process.memoryUsage();
    return {
      timestamp: new Date().toISOString(),
      uptimeSec: process.uptime(),
      cpuLoad: os.loadavg()[0],
      heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
      rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
      bufferedMetrics: this.buffer.length,
      lastFlush: new Date(this.lastFlush).toISOString(),
      environment: config.NODE_ENV,
    };
  }

  /* ------------------------------------------------------------------------
     🧩 On-demand tracing wrapper
  ------------------------------------------------------------------------ */
  async traceAsync<T>(
    spanName: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> {
    const span = this.tracer.startSpan(spanName, { attributes });
    try {
      const result = await fn();
      span.setStatus({ code: 1, message: "OK" });
      return result;
    } catch (err: any) {
      span.setStatus({ code: 2, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  }
}

/* ------------------------------------------------------------------------
   🧭 Instance Export (Singleton)
------------------------------------------------------------------------ */
export const telemetry = new Telemetry();

/* ------------------------------------------------------------------------
   🧩 Graceful Shutdown Hooks
------------------------------------------------------------------------ */
process.on("SIGTERM", async () => {
  await telemetry.shutdown();
});

process.on("SIGINT", async () => {
  await telemetry.shutdown();
});

/* ------------------------------------------------------------------------
   🧩 Snapshot Export Helper
------------------------------------------------------------------------ */
export const telemetrySnapshot = () => telemetry.snapshot();

export default telemetry;