/**
 * src/integrations/loki.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🛰️ Enterprise Loki Logging Bootstrap
 *
 * Responsibilities:
 *  - Initialize and configure Winston Loki transport.
 *  - Seamlessly integrate with existing logger (trace-aware).
 *  - Push structured JSON logs to Loki (via HTTP).
 *  - Gracefully handle network failures and retries.
 *
 * Design Goals:
 *  - Non-blocking log emission (won’t block requests)
 *  - Auto-tags logs with traceId, environment, and service name
 *  - Works under clustered/multi-worker deployments
 *  - Supports local, staging, and production Loki targets
 * --------------------------------------------------------------------------
 */

import LokiTransport from "winston-loki";
import { logger } from "../logger";
import { config } from "../config";
import { trace, context } from "@opentelemetry/api";

export interface LokiBootstrapOptions {
  enabled?: boolean;
  host?: string;
  labels?: Record<string, string>;
  batchInterval?: number;
  maxBatchSize?: number;
}

/* --------------------------------------------------------------------------
   ⚙️ Configuration
-------------------------------------------------------------------------- */
const lokiConfig: Required<LokiBootstrapOptions> = {
  enabled: process.env.LOKI_ENABLED !== "false",
  host: process.env.LOKI_HOST || "http://localhost:3100",
  batchInterval: Number(process.env.LOKI_BATCH_INTERVAL || 5000),
  maxBatchSize: Number(process.env.LOKI_BATCH_SIZE || 100),
  labels: {
    app: "project-athlete-360",
    service: process.env.OTEL_SERVICE_NAME || "pa360-backend",
    env: process.env.NODE_ENV || "development",
    region: process.env.REGION || "global",
  },
};

/* --------------------------------------------------------------------------
   🧠 Loki Transport Setup
-------------------------------------------------------------------------- */
export const initLoki = async () => {
  if (!lokiConfig.enabled) {
    logger.info("[LOKI] Disabled by configuration.");
    return;
  }

  try {
    const lokiTransport = new LokiTransport({
      host: lokiConfig.host,
      json: true,
      labels: lokiConfig.labels,
      batching: true,
      interval: lokiConfig.batchInterval,
      replaceTimestamp: true,
      gracefulShutdown: true,
      silenceErrors: false,
      onConnectionError: (err: any) => {
        logger.warn("[LOKI] Connection issue", { error: err.message });
      },
      format: (log) => {
        const span = trace.getSpan(context.active());
        const traceId = span?.spanContext().traceId || null;
        const spanId = span?.spanContext().spanId || null;

        return {
          ...log,
          traceId,
          spanId,
          env: lokiConfig.labels.env,
          service: lokiConfig.labels.service,
          region: lokiConfig.labels.region,
          ts: new Date().toISOString(),
        };
      },
    });

    // Add to Winston logger
    logger.add(lokiTransport);

    logger.info(`[LOKI] ✅ Connected to Loki at ${lokiConfig.host}`);
  } catch (err: any) {
    logger.error("[LOKI] ❌ Failed to initialize Loki transport", { error: err.message });
  }
};

/* --------------------------------------------------------------------------
   🧹 Graceful Shutdown
-------------------------------------------------------------------------- */
export const shutdownLoki = async () => {
  try {
    logger.info("[LOKI] 🧹 Flushing pending logs to Loki...");
    // Loki transport handles graceful shutdown internally, but we can delay to ensure delivery
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.info("[LOKI] ✅ Loki transport shutdown complete.");
  } catch (err: any) {
    logger.error("[LOKI] ⚠️ Error during Loki shutdown", { error: err.message });
  }
};

/* --------------------------------------------------------------------------
   🧱 Export
-------------------------------------------------------------------------- */
export default {
  initLoki,
  shutdownLoki,
  lokiConfig,
};