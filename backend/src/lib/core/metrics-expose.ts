/**
 * src/lib/core/metrics-expose.ts
 * ------------------------------------------------------------------------
 * 🌐 Enterprise Metrics Exposure Utility for Project Athlete 360
 *
 * Responsibilities:
 *  - Expose Prometheus metrics endpoint (/metrics)
 *  - Secure with optional API key / auth
 *  - Support JSON summary for internal dashboards
 *  - Rate-limit requests to avoid scraping abuse
 *  - Gracefully handle unavailable metrics / registry issues
 *
 * Features:
 *  - Integrates with src/lib/core/metrics.ts registry
 *  - Includes health snapshot (CPU, memory, uptime)
 *  - Supports Prometheus text format and JSON output
 *  - Non-blocking and safe for clustered environments
 * ------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { register, getSystemSnapshot, getMetrics } from "./metrics";
import { logger } from "../../logger";
import { config } from "../../config";

/* ------------------------------------------------------------------------
   ⚙️ Configuration
------------------------------------------------------------------------ */
const METRICS_API_KEY = process.env.METRICS_API_KEY || config.METRICS_API_KEY || null;
const METRICS_RATE_LIMIT = Number(process.env.METRICS_RATE_LIMIT || 60); // req/min

/* ------------------------------------------------------------------------
   🚦 Rate Limiter for Metrics Endpoint
------------------------------------------------------------------------ */
export const metricsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: METRICS_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many metric requests. Try again later.",
});

/* ------------------------------------------------------------------------
   🔐 Optional Authentication Middleware
------------------------------------------------------------------------ */
export const metricsAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!METRICS_API_KEY) return next(); // open metrics in dev/local
  const token = req.headers["x-metrics-key"] || req.query.key;
  if (token === METRICS_API_KEY) return next();

  logger.warn("[METRICS] Unauthorized access attempt detected", {
    ip: req.ip,
    path: req.originalUrl,
  });

  return res.status(401).json({ success: false, message: "Unauthorized: Invalid metrics key" });
};

/* ------------------------------------------------------------------------
   📈 Prometheus Metrics Endpoint Handler
------------------------------------------------------------------------ */
export const exposeMetrics = async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader("Content-Type", register.contentType);
    const metricsData = await getMetrics();
    res.status(200).send(metricsData);
  } catch (err: any) {
    logger.error("[METRICS] Failed to expose metrics", { err: err.message });
    res.status(500).json({
      success: false,
      message: "Failed to expose metrics",
      error: err.message,
    });
  }
};

/* ------------------------------------------------------------------------
   🧠 JSON Summary Endpoint
------------------------------------------------------------------------ */
export const exposeMetricsSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = getSystemSnapshot();
    const uptimeHrs = (snapshot.uptimeSec / 3600).toFixed(2);

    res.status(200).json({
      success: true,
      environment: process.env.NODE_ENV,
      service: process.env.OTEL_SERVICE_NAME || "pa360-backend",
      metrics: {
        uptime_hours: uptimeHrs,
        cpu_load: snapshot.cpuLoad,
        memory_mb: snapshot.memoryMB,
      },
      timestamp: snapshot.timestamp,
    });
  } catch (err: any) {
    logger.error("[METRICS] Summary endpoint error", { err: err.message });
    res.status(500).json({
      success: false,
      message: "Metrics summary unavailable",
    });
  }
};

/* ------------------------------------------------------------------------
   🧩 Register Express Routes
   (Call from app.ts or routes/metrics.route.ts)
------------------------------------------------------------------------ */
export const registerMetricsRoutes = (app: import("express").Application) => {
  app.get(
    "/metrics",
    metricsLimiter,
    metricsAuth,
    exposeMetrics
  );

  app.get(
    "/metrics/summary",
    metricsLimiter,
    metricsAuth,
    exposeMetricsSummary
  );

  logger.info("[METRICS] ✅ Metrics routes registered (/metrics, /metrics/summary)");
};

/* ------------------------------------------------------------------------
   📦 Export Module
------------------------------------------------------------------------ */
export default {
  registerMetricsRoutes,
  exposeMetrics,
  exposeMetricsSummary,
  metricsLimiter,
  metricsAuth,
};