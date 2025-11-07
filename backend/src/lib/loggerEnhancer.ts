/**
 * src/lib/loggerEnhancer.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Logger Enhancer Middleware
 *
 * Features:
 *  - Assigns unique correlation IDs (traceId) to every request.
 *  - Integrates with OpenTelemetry context for trace propagation.
 *  - Structured JSON logs with severity and performance metadata.
 *  - Detects slow or degraded requests automatically.
 *  - Sanitizes sensitive data before logging.
 *  - Works even if telemetry subsystem is unavailable.
 * --------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { context, trace } from "@opentelemetry/api";
import logger from "../logger";
import { telemetry } from "./telemetry";
import { config } from "../config";

/* --------------------------------------------------------------------------
   🧩 Correlation ID Attachment
-------------------------------------------------------------------------- */
export const attachRequestId = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const traceSpan = trace.getSpan(context.active());
    const otelTraceId = traceSpan?.spanContext()?.traceId;
    const requestId = otelTraceId || randomUUID();

    (req as any).requestId = requestId;
    req.headers["x-request-id"] = requestId;

    logger.debug(`[TRACE] Correlation ID attached`, { requestId });
  } catch (err: any) {
    logger.warn("[LOGGER-ENHANCER] Failed to attach requestId", { error: err.message });
  }
  next();
};

/* --------------------------------------------------------------------------
   📊 Enterprise Request Logger
-------------------------------------------------------------------------- */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const requestId = (req as any).requestId || randomUUID();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    const status = res.statusCode;
    const user = (req as any).user || {};
    const userId = user?.id || "guest";
    const actorRole = user?.role || "public";
    const route = req.originalUrl || req.path;

    // Record metrics safely
    try {
      telemetry.record("http.request.duration.ms", durationMs, "histogram", {
        route,
        method: req.method,
        status: status.toString(),
      });
    } catch (err) {
      logger.debug("[LOGGER-ENHANCER] telemetry.record failed", { error: err.message });
    }

    const logPayload = sanitizeForLogs({
      service: config.serviceName || "pa360-backend",
      env: config.nodeEnv,
      region: config.region || "global",
      requestId,
      traceId: req.headers["x-request-id"],
      method: req.method,
      path: route,
      status,
      durationMs: Number(durationMs.toFixed(2)),
      userId,
      actorRole,
      ip: req.ip,
      ua: req.headers["user-agent"],
      timestamp: new Date().toISOString(),
    });

    // Dynamic log severity
    if (status >= 500) logger.error(`[HTTP ${status}] ${req.method} ${route}`, logPayload);
    else if (status >= 400) logger.warn(`[HTTP ${status}] ${req.method} ${route}`, logPayload);
    else logger.info(`[HTTP ${status}] ${req.method} ${route}`, logPayload);
  });

  next();
};

/* --------------------------------------------------------------------------
   🕒 Slow Request Detector (with metrics)
-------------------------------------------------------------------------- */
export const slowRequestMonitor = (thresholdMs = 1200) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;

      if (durationMs > thresholdMs) {
        const userId = (req as any).user?.id || "guest";
        const durationSec = (durationMs / 1000).toFixed(2);

        logger.warn(`[SLOW REQUEST] ${req.method} ${req.originalUrl} took ${durationSec}s`, {
          durationMs,
          thresholdMs,
          userId,
          requestId: (req as any).requestId,
        });

        try {
          telemetry.record("http.request.slow.count", 1, "counter", {
            route: req.originalUrl,
            bucket: `${Math.ceil(durationMs / 1000)}s`,
          });
        } catch (err: any) {
          logger.debug("[LOGGER-ENHANCER] telemetry.record slow request failed", {
            error: err.message,
          });
        }
      }
    });

    next();
  };
};

/* --------------------------------------------------------------------------
   🧼 PII Sanitizer (for Log Compliance)
-------------------------------------------------------------------------- */
export const sanitizeForLogs = (data: any): any => {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };

  // Mask sensitive fields
  const sensitiveFields = ["password", "token", "email", "phone", "auth", "apiKey"];
  for (const field of sensitiveFields) {
    if (clone[field]) clone[field] = "[REDACTED]";
  }

  // Nested objects
  for (const key in clone) {
    if (typeof clone[key] === "object" && clone[key] !== null) {
      clone[key] = sanitizeForLogs(clone[key]);
    }
  }

  return clone;
};

/* --------------------------------------------------------------------------
   ✅ Summary / Usage
-------------------------------------------------------------------------- */
/**
 * Example usage:
 *
 * import express from "express";
 * import {
 *   attachRequestId,
 *   requestLogger,
 *   slowRequestMonitor
 * } from "../lib/loggerEnhancer";
 *
 * const app = express();
 * app.use(attachRequestId);
 * app.use(requestLogger);
 * app.use(slowRequestMonitor(1500));
 *
 * ✅ Logs automatically include requestId & traceId.
 * ✅ Metrics flow to Prometheus / OTEL exporters.
 * ✅ Detects & logs slow requests dynamically.
 */