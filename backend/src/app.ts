// src/app.ts
/**
 * src/app.ts
 * ------------------------------------------------------------------------
 * Enterprise-grade Express application bootstrap
 *
 * Features:
 *  - Secure defaults (helmet, CORS, compression)
 *  - Request correlation (request-id)
 *  - Structured request logging & slow-request monitoring
 *  - Prometheus metrics endpoint
 *  - Optional OpenTelemetry / Sentry integration (enabled via config)
 *  - Rate limiting, JSON size limits, body parsing
 *  - Health & readiness endpoints
 *  - Graceful error handling (centralized)
 * ------------------------------------------------------------------------
 */

import express, { Application, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { config } from "./config";
import { logger, morganStream } from "./logger";
import routes from "./routes";
import { attachRequestId, requestLogger as structuredRequestLogger, slowRequestMonitor } from "./lib/loggerEnhancer";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { getMetrics } from "./lib/core/metrics";
import { telemetry } from "./lib/telemetry";

// Optional observability / tracing initializers (best-effort)
(async function initOptionalIntegrations() {
  try {
    if (config.tracing?.enabled) {
      // dynamic import to keep dependencies optional
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { initTracing } = require("./lib/tracing");
      await initTracing(config.tracing);
      logger.info("[INIT] Tracing initialized.");
    }
  } catch (err: any) {
    logger.warn("[INIT] Tracing initialization failed (continuing):", err?.message || err);
  }

  try {
    if (config.sentry?.dsn) {
      // dynamic import for Sentry
      /* eslint-disable @typescript-eslint/no-var-requires */
      const Sentry = require("@sentry/node");
      Sentry.init({
        dsn: config.sentry.dsn,
        environment: config.nodeEnv,
        tracesSampleRate: config.sentry.tracesSampleRate ?? 0.0,
      });
      logger.info("[INIT] Sentry initialized.");
    }
  } catch (err: any) {
    logger.warn("[INIT] Sentry initialization failed (continuing):", err?.message || err);
  }
})();

const app: Application = express();

// ────────────────────────────────────────────────────
// Security / Network Middleware
// ────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: config.nodeEnv === "production" ? undefined : false,
  })
);

app.use(
  cors({
    origin: config.CLIENT_URLS,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(compression());
app.use(cookieParser());

// ────────────────────────────────────────────────────
// Body parsers
// ────────────────────────────────────────────────────
app.use(express.json({ limit: config.requestBodyLimit || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: config.requestBodyLimit || "10mb" }));

// ────────────────────────────────────────────────────
// Request Correlation + Logging
// ────────────────────────────────────────────────────
// Attach a stable request id early so it flows through logs/metrics/traces
app.use(attachRequestId);

// Morgan -> Winston bridge (keeps access logs)
app.use(morgan(config.logging?.morganFormat || "combined", { stream: morganStream }));

// Structured per-request logging + slow request monitor
app.use(structuredRequestLogger);
app.use(slowRequestMonitor(config.performance?.slowRequestThresholdMs ?? 1200));

// Optional telemetry enrichment middleware (attaches trace info to telemetry)
app.use((req: Request, _res: Response, next: NextFunction) => {
  try {
    // attach minimal telemetry context for exporters
    (req as any).telemetryContext = {
      requestId: (req as any).requestId,
      startAt: Date.now(),
      route: req.originalUrl,
      method: req.method,
    };
  } catch {}
  next();
});

// ────────────────────────────────────────────────────
// Rate limiting (API-wide; override per-route if needed)
// ────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs ?? 15 * 60 * 1000,
  max: config.rateLimit?.maxRequests ?? 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// ────────────────────────────────────────────────────
// Health / Readiness / Metrics
// ────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) =>
  res.status(200).json({
    success: true,
    env: config.nodeEnv,
    uptimeSec: process.uptime(),
    timestamp: new Date().toISOString(),
  })
);

app.get("/ready", async (_req: Request, res: Response) => {
  // perform lightweight readiness checks: DB, storage, queues (if available)
  const readiness: Record<string, any> = { ok: true };
  try {
    // lazy import to avoid cycles if prisma not available during early bootstrap
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require("./prismaClient");
    await prisma.$queryRaw`SELECT 1`;
    readiness.db = "ok";
  } catch (err: any) {
    readiness.ok = false;
    readiness.db = "unreachable";
  }

  res.status(readiness.ok ? 200 : 503).json({ success: readiness.ok, readiness });
});

// Prometheus metrics endpoint
app.get("/metrics", async (_req: Request, res: Response) => {
  try {
    res.set("Content-Type", (await getMetrics()).contentType || "text/plain; version=0.0.4");
    const metrics = await getMetrics();
    res.send(metrics);
  } catch (err: any) {
    logger.warn("[METRICS] Failed to collect metrics:", err?.message || err);
    res.status(500).send("Metrics collection failed");
  }
});

// ────────────────────────────────────────────────────
// Primary API routes (versioned)
// ────────────────────────────────────────────────────
app.use("/api", routes);

// ────────────────────────────────────────────────────
// Catch-all 404 for non-API routes (use notFoundHandler)
app.use("*", notFoundHandler);

// ────────────────────────────────────────────────────
// Centralized Error Handler (must be last)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  try {
    // enrich telemetry with error info
    const ctx = (req as any).telemetryContext;
    if (ctx) {
      telemetry.record("errors.request", 1, "counter", {
        requestId: ctx.requestId,
        route: ctx.route,
        method: ctx.method,
      });
    }
  } catch {}

  return errorHandler(err, req, res, next);
});

export default app;