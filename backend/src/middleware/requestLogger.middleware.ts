/**
 * src/middleware/requestLogger.middleware.ts
 * ---------------------------------------------------------------------------
 * 🌐 Enterprise Request Logger Middleware
 *
 * Integrates with:
 *  - Winston enterprise logger (structured JSON)
 *  - OpenTelemetry tracing (traceId + spanId injection)
 *  - Metrics & Telemetry systems for latency and throughput
 *
 * Features:
 *  - Captures request/response lifecycle with duration
 *  - Attaches correlation ID (requestId) for all downstream logs
 *  - Handles user/session metadata for traceability
 *  - Detects slow requests (> threshold)
 * ---------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { context, trace } from "@opentelemetry/api";
import { telemetry } from "../lib/telemetry";
import { logger } from "../logger";

// ───────────────────────────────────────────────
// ⚙️ Configurable thresholds
// ───────────────────────────────────────────────
const SLOW_REQUEST_THRESHOLD_MS = 1000;

// ───────────────────────────────────────────────
// 🛰 Middleware Implementation
// ───────────────────────────────────────────────
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const requestId = randomUUID();

  // Attach correlation ID to the request
  (req as any).requestId = requestId;
  req.headers["x-request-id"] = requestId;

  // Capture trace context (if exists)
  const activeSpan = trace.getSpan(context.active());
  const traceContext = activeSpan ? activeSpan.spanContext() : undefined;

  // Store original send to measure latency
  const originalSend = res.send.bind(res);

  res.send = (body?: any): Response => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const status = res.statusCode;
    const method = req.method;
    const path = req.originalUrl;
    const userId = (req as any).user?.id || "unauthenticated";

    // Record telemetry metric
    telemetry.record("http.request.duration.ms", durationMs, "timer", {
      method,
      route: path,
      status: String(status),
    });

    // Structured JSON log entry
    const logEntry = {
      requestId,
      traceId: traceContext?.traceId || null,
      spanId: traceContext?.spanId || null,
      method,
      path,
      status,
      durationMs: Number(durationMs.toFixed(2)),
      userId,
      ip: req.ip,
      ua: req.headers["user-agent"] || "unknown",
    };

    // Categorize log level
    if (status >= 500) logger.error("[HTTP ERROR]", logEntry);
    else if (status >= 400) logger.warn("[HTTP WARN]", logEntry);
    else logger.info("[HTTP OK]", logEntry);

    // Flag slow requests
    if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn("[HTTP SLOW REQUEST]", {
        ...logEntry,
        warning: `Request exceeded ${SLOW_REQUEST_THRESHOLD_MS}ms`,
      });
    }

    // Return response
    return originalSend(body);
  };

  next();
};

// ───────────────────────────────────────────────
// 🧠 Optional middleware: attach correlation only
// (useful for worker → API trace continuity)
// ───────────────────────────────────────────────
export const attachCorrelationId = (req: Request, _res: Response, next: NextFunction) => {
  if (!(req as any).requestId) {
    (req as any).requestId = randomUUID();
    req.headers["x-request-id"] = (req as any).requestId;
  }
  next();
};

// ───────────────────────────────────────────────
// 🧩 Example Express Integration:
//
// import express from "express";
// import { requestLogger } from "../middleware/requestLogger.middleware";
//
// const app = express();
// app.use(requestLogger);
// app.listen(3000);
// ───────────────────────────────────────────────