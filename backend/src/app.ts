// src/app.ts
/**
 * ------------------------------------------------------------------------
 * 🧠 Project Athlete 360 — Secure Express Application Bootstrap (v3.2)
 * ------------------------------------------------------------------------
 * Features:
 *  ✅ OWASP-compliant defaults (Helmet, CSP, HSTS, XSS, Referrer Policy)
 *  ✅ Strict CORS (frontend allowlist only)
 *  ✅ Secure cookie/session handling
 *  ✅ Redis-backed rate limiter (DoS protection)
 *  ✅ Request correlation, structured logs, and slow-request monitoring
 *  ✅ Prometheus metrics + OpenTelemetry traces
 *  ✅ Sentry error aggregation (optional)
 *  ✅ Auto-sanitization for incoming body & query payloads
 * ------------------------------------------------------------------------
 */

import express, { Application, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import hpp from "hpp";
import { xss } from "express-xss-sanitizer";

import { config } from "./config";
import { logger, morganStream } from "./logger";
import routes from "./routes";
import { attachRequestId, requestLogger as structuredRequestLogger, slowRequestMonitor } from "./lib/loggerEnhancer";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { getMetrics } from "./lib/core/metrics";
import { telemetry } from "./lib/telemetry";
import { redisRateLimiter } from "./lib/rateLimiterRedis";
import { sanitizeInputMiddleware } from "./middleware/sanitization.middleware"; // new sanitization layer
import { cspMiddleware } from "./middleware/csp.middleware"; // strict CSP

// ───────────────────────────────────────────────────────
// 🔧 Initialize optional observability & error tracking
// ───────────────────────────────────────────────────────
(async function initOptionalIntegrations() {
  try {
    if (config.tracing?.enabled) {
      const { initTracing } = require("./lib/tracing");
      await initTracing(config.tracing);
      logger.info("[INIT] Tracing initialized.");
    }
  } catch (err: any) {
    logger.warn("[INIT] Tracing init failed:", err?.message);
  }

  try {
    if (config.sentry?.dsn) {
      const Sentry = require("@sentry/node");
      Sentry.init({
        dsn: config.sentry.dsn,
        environment: config.nodeEnv,
        tracesSampleRate: config.sentry.tracesSampleRate ?? 0.2,
        integrations: [],
      });
      logger.info("[INIT] Sentry initialized.");
    }
  } catch (err: any) {
    logger.warn("[INIT] Sentry init failed:", err?.message);
  }
})();

const app: Application = express();

// ───────────────────────────────────────────────────────
// 🛡️ Security Middleware (Strict OWASP Standards)
// ───────────────────────────────────────────────────────
app.set("trust proxy", 1); // for secure cookies behind reverse proxy/load balancer

app.use(
  helmet({
    contentSecurityPolicy: false, // custom CSP handled by cspMiddleware below
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    xssFilter: true,
  })
);

// Strict CSP (whitelist only known domains)
app.use(cspMiddleware);

// Prevent HTTP parameter pollution
app.use(hpp());

// Sanitize malicious XSS payloads automatically
app.use(xss());

// Auto-sanitize user input (body/query params)
app.use(sanitizeInputMiddleware);

// ───────────────────────────────────────────────────────
// 🌐 CORS (Frontend domain allowlist)
// ───────────────────────────────────────────────────────
const allowedOrigins = Array.isArray(config.CLIENT_URLS)
  ? config.CLIENT_URLS
  : [config.CLIENT_URLS];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Requested-With",
      "x-request-id",
    ],
  })
);

app.use(cookieParser());
app.use(compression());

// ───────────────────────────────────────────────────────
// 📦 Body Parsing & Size Limits
// ───────────────────────────────────────────────────────
app.use(express.json({ limit: config.requestBodyLimit || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: config.requestBodyLimit || "10mb" }));

// ───────────────────────────────────────────────────────
// 🧩 Request Correlation & Logging
// ───────────────────────────────────────────────────────
app.use(attachRequestId);
app.use(morgan(config.logging?.morganFormat || "combined", { stream: morganStream }));
app.use(structuredRequestLogger);
app.use(slowRequestMonitor(config.performance?.slowRequestThresholdMs ?? 1200));

// Attach telemetry context
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).telemetryContext = {
    requestId: (req as any).requestId,
    startAt: Date.now(),
    route: req.originalUrl,
    method: req.method,
  };
  next();
});

// ───────────────────────────────────────────────────────
// ⚙️ Rate Limiting (Redis-backed recommended)
// ───────────────────────────────────────────────────────
if (config.nodeEnv === "production") {
  app.use("/api", redisRateLimiter);
} else {
  const basicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api", basicLimiter);
}

// ───────────────────────────────────────────────────────
// 💓 Health / Readiness / Metrics
// ───────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) =>
  res.status(200).json({
    success: true,
    env: config.nodeEnv,
    uptimeSec: process.uptime(),
    timestamp: new Date().toISOString(),
  })
);

app.get("/ready", async (_req: Request, res: Response) => {
  const readiness: Record<string, any> = { ok: true };
  try {
    const { prisma } = require("./prismaClient");
    await prisma.$queryRaw`SELECT 1`;
    readiness.db = "ok";
  } catch {
    readiness.ok = false;
    readiness.db = "unreachable";
  }
  res.status(readiness.ok ? 200 : 503).json({ success: readiness.ok, readiness });
});

// Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.set("Content-Type", metrics.contentType || "text/plain");
    res.send(metrics.metrics);
  } catch (err: any) {
    logger.warn("[METRICS] Failed to collect metrics:", err?.message);
    res.status(500).send("Metrics collection failed");
  }
});

// ───────────────────────────────────────────────────────
// 🚀 Core Routes
// ───────────────────────────────────────────────────────
app.use("/api", routes);

// 404 + Error Handler
app.use("*", notFoundHandler);
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  try {
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