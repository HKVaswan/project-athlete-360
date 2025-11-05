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
  const traceSpan = trace.getSpan(context.active());
  const otelTraceId = traceSpan?.spanContext()?.traceId;
  const requestId = otelTraceId || randomUUID();

  (req as any).requestId = requestId;
  req.headers["x-request-id"] = requestId;

  // Enrich logger context (optional per-request scoping)
  logger.debug(`[TRACE] Attached correlation ID: ${requestId}`);

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
    const userId = (req as any).user?.id || "guest";
    const actorRole = (req as any).user?.role || "public";

    // Record performance metrics
    telemetry.record("http.request.duration.ms", durationMs, "histogram", {
      route: req.originalUrl,
      method: req.method,
      status: status.toString(),
    });

    const logPayload = {
      service: config.serviceName || "backend",
      env: config.nodeEnv,
      region: config.region || "global",
      requestId,
      traceId: req.headers["x-request-id"],
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs: Number(durationMs.toFixed(2)),
      userId,
      actorRole,
      ip: req.ip,
      ua: req.headers["user-agent"],
      timestamp: new Date().toISOString(),
    };

    // Choose severity dynamically
    if (status >= 500) logger.error(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logPayload);
    else if (status >= 400) logger.warn(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logPayload);
    else logger.info(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logPayload);
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
        logger.warn(`[SLOW REQUEST] ${req.method} ${req.originalUrl} took ${durationMs.toFixed(2)}ms`, {
          durationMs,
          thresholdMs,
          userId,
          requestId: (req as any).requestId,
        });

        telemetry.record("http.request.slow.count", 1, "counter", {
          route: req.originalUrl,
          durationBucket: `${Math.ceil(durationMs / 1000)}s`,
        });
      }
    });

    next();
  };
};

/* --------------------------------------------------------------------------
   🧼 PII Sanitizer (Optional for Security Compliance)
-------------------------------------------------------------------------- */
export const sanitizeForLogs = (data: any): any => {
  if (!data) return data;
  const cloned = { ...data };

  // Mask sensitive fields if present
  ["password", "token", "email", "phone"].forEach((field) => {
    if (cloned[field]) cloned[field] = "[REDACTED]";
  });

  return cloned;
};

/* --------------------------------------------------------------------------
   ✅ Summary
-------------------------------------------------------------------------- */
/**
 * Recommended usage:
 *
 * import express from "express";
 * import { attachRequestId, requestLogger, slowRequestMonitor } from "../lib/loggerEnhancer";
 *
 * const app = express();
 * app.use(attachRequestId);
 * app.use(requestLogger);
 * app.use(slowRequestMonitor(1500));
 *
 * Metrics automatically flow to Prometheus/OpenTelemetry + logs correlate via requestId.
 */