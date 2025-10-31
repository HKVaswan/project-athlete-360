/**
 * AI Telemetry Reporter
 * ---------------------
 * - Collects metrics from AI requests and health monitors.
 * - Pushes aggregated metrics to analytics/logging systems.
 * - Supports Prometheus, custom REST, or internal DB endpoints.
 * - Includes graceful fallback and offline caching.
 */

import { AiProviderManager } from "./aiProviderManager";
import logger from "../logger";
import fs from "fs";
import path from "path";

interface TelemetryEvent {
  providerId: string;
  type: "request" | "response" | "error" | "health";
  timestamp: number;
  latencyMs?: number;
  success?: boolean;
  error?: string;
  meta?: Record<string, any>;
}

interface ReporterOptions {
  flushIntervalMs?: number;
  batchSize?: number;
  output?: "prometheus" | "file" | "api";
  apiEndpoint?: string;
  maxCacheSize?: number;
}

/**
 * AI Telemetry Reporter
 * ---------------------------------------------------------
 * Collects events from all AI components and exports metrics
 * to external monitoring systems or local files.
 */
export class AiTelemetryReporter {
  private events: TelemetryEvent[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private readonly cacheFile: string;
  private readonly opts: Required<ReporterOptions>;

  constructor(private manager: AiProviderManager, opts?: ReporterOptions) {
    this.opts = {
      flushIntervalMs: opts?.flushIntervalMs ?? 60_000,
      batchSize: opts?.batchSize ?? 50,
      output: opts?.output ?? "file",
      apiEndpoint: opts?.apiEndpoint ?? "",
      maxCacheSize: opts?.maxCacheSize ?? 5000,
    };

    this.cacheFile = path.resolve(process.cwd(), "ai_telemetry_cache.json");
  }

  /**
   * Start telemetry collection
   */
  start() {
    if (this.intervalId) return;
    logger.info(`[AI Telemetry] 📡 Starting reporter (${this.opts.flushIntervalMs / 1000}s interval)`);

    this.intervalId = setInterval(() => this.flush(), this.opts.flushIntervalMs);

    // Attempt to load cached data (for durability)
    this.loadCachedData();
  }

  /**
   * Stop telemetry collection
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("[AI Telemetry] 🧹 Stopped reporter");
    }
  }

  /**
   * Record telemetry event
   */
  record(event: TelemetryEvent) {
    this.events.push(event);
    if (this.events.length >= this.opts.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flush telemetry events to output target
   */
  private async flush() {
    if (this.events.length === 0) return;

    const batch = this.events.splice(0, this.opts.batchSize);
    try {
      switch (this.opts.output) {
        case "prometheus":
          await this.exportToPrometheus(batch);
          break;
        case "api":
          await this.exportToApi(batch);
          break;
        case "file":
        default:
          await this.exportToFile(batch);
          break;
      }
    } catch (err: any) {
      logger.warn(`[AI Telemetry] ❗Failed to export batch: ${err.message}`);
      this.cacheFailedBatch(batch);
    }
  }

  /**
   * Export to Prometheus or compatible systems
   */
  private async exportToPrometheus(batch: TelemetryEvent[]) {
    // Prometheus uses a pull model, but we can expose metrics to be scraped
    const metrics = batch.map(
      (e) =>
        `ai_request_latency_ms{provider="${e.providerId}"} ${e.latencyMs ?? 0}\n` +
        `ai_request_success{provider="${e.providerId}"} ${e.success ? 1 : 0}`
    );

    const file = path.resolve(process.cwd(), "ai_metrics.prom");
    fs.appendFileSync(file, metrics.join("\n") + "\n");
    logger.debug(`[AI Telemetry] Exported ${batch.length} metrics to Prometheus file`);
  }

  /**
   * Export metrics to REST API (e.g., Elastic, Grafana Loki, etc.)
   */
  private async exportToApi(batch: TelemetryEvent[]) {
    if (!this.opts.apiEndpoint) throw new Error("API endpoint not configured");
    await fetch(this.opts.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: Date.now(), events: batch }),
    });
    logger.debug(`[AI Telemetry] Exported ${batch.length} events to API`);
  }

  /**
   * Export metrics to file (local fallback)
   */
  private async exportToFile(batch: TelemetryEvent[]) {
    const logFile = path.resolve(process.cwd(), "ai_telemetry.log");
    const data = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(logFile, data);
    logger.debug(`[AI Telemetry] Wrote ${batch.length} events to local file`);
  }

  /**
   * Cache failed batches locally (resilient telemetry)
   */
  private cacheFailedBatch(batch: TelemetryEvent[]) {
    const existing = this.loadCachedData();
    const updated = [...existing, ...batch].slice(-this.opts.maxCacheSize);
    fs.writeFileSync(this.cacheFile, JSON.stringify(updated, null, 2));
    logger.warn(`[AI Telemetry] Cached ${batch.length} failed telemetry events`);
  }

  /**
   * Load cached data (if exists)
   */
  private loadCachedData(): TelemetryEvent[] {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, "utf8");
        const parsed = JSON.parse(raw);
        this.events.push(...parsed);
        fs.unlinkSync(this.cacheFile);
        logger.info(`[AI Telemetry] Restored ${parsed.length} cached events`);
        return parsed;
      }
    } catch (err: any) {
      logger.warn(`[AI Telemetry] Failed to load cache: ${err.message}`);
    }
    return [];
  }

  /**
   * Report AI request (to be used by provider adapters)
   */
  trackRequest(providerId: string, latencyMs: number, success: boolean, meta?: any) {
    this.record({
      providerId,
      type: "response",
      timestamp: Date.now(),
      latencyMs,
      success,
      meta,
    });
  }
}

/**
 * Factory to initialize telemetry reporter
 */
export const startAiTelemetryReporter = (manager: AiProviderManager) => {
  const reporter = new AiTelemetryReporter(manager, {
    flushIntervalMs: 60_000,
    output: "file", // can change later to "api" or "prometheus"
  });
  reporter.start();
  return reporter;
};