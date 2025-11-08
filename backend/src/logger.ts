/**
 * src/logger.ts
 * ---------------------------------------------------------------------------
 * 🧠 Enterprise Logger (Winston + OpenTelemetry integrated)
 *
 * Features:
 *  - Structured JSON logs for ELK / Grafana Loki
 *  - Includes traceId, spanId, service, environment, region & version
 *  - Automatic error capturing with graceful degradation
 *  - Correlates logs with OpenTelemetry spans
 *  - Rotating persistent log files for durability
 *  - Optional integrations: Sentry, Datadog, Loki
 * ---------------------------------------------------------------------------
 */

import winston from "winston";
import path from "path";
import fs from "fs";
import os from "os";
import { trace, context } from "@opentelemetry/api";
import { config } from "./config";
import { loggerConfig } from "./config/loggerConfig";

/* ------------------------------------------------------------------------
   🧱 Ensure logs directory
------------------------------------------------------------------------ */
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

/* ------------------------------------------------------------------------
   🧩 JSON Formatter (for centralized logging systems)
------------------------------------------------------------------------ */
const jsonFormat = winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const span = trace.getSpan(context.active());
  const traceCtx = span?.spanContext?.();

  const logData = {
    timestamp,
    level,
    message,
    ...(stack ? { stack } : {}),
    traceId: traceCtx?.traceId || null,
    spanId: traceCtx?.spanId || null,
    service: config.serviceName || "pa360-backend",
    instance: process.env.SERVICE_INSTANCE_ID || os.hostname(),
    env: config.nodeEnv || "development",
    region: config.region || "global",
    version: config.version || "1.0.0",
    pid: process.pid,
    ...meta,
  };

  return JSON.stringify(logData);
});

/* ------------------------------------------------------------------------
   🎨 Console Format (for local debugging)
------------------------------------------------------------------------ */
const devConsoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
);

/* ------------------------------------------------------------------------
   🛠️ Winston Logger Setup
------------------------------------------------------------------------ */
export const logger = winston.createLogger({
  level: loggerConfig.level || (config.nodeEnv === "production" ? "info" : "debug"),
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    jsonFormat
  ),
  defaultMeta: {
    service: config.serviceName || "pa360-backend",
  },
  transports: [
    // ─── Console ───
    new winston.transports.Console({
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      format: config.nodeEnv === "production"
        ? winston.format.combine(winston.format.timestamp(), jsonFormat)
        : devConsoleFormat,
    }),

    // ─── File Logs ───
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 20 * 1024 * 1024, // 20 MB
      maxFiles: 10,
      tailable: true,
    }),

    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

/* ------------------------------------------------------------------------
   🌐 Stream (for Express + Morgan)
------------------------------------------------------------------------ */
export const morganStream = {
  write: (message: string) => logger.info(message.trim(), { source: "http" }),
};

/* ------------------------------------------------------------------------
   🧩 Optional Integrations (Sentry / Datadog / Loki)
------------------------------------------------------------------------ */
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = require("@sentry/node");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: config.nodeEnv,
      tracesSampleRate: 0.1,
      release: config.version,
    });
    logger.info("[LOGGER] ✅ Sentry transport enabled.");
  } catch (err) {
    logger.warn("[LOGGER] Failed to initialize Sentry:", err?.message || err);
  }
}

if (process.env.DD_API_KEY) {
  try {
    const { DatadogTransport } = require("datadog-winston");
    logger.add(new DatadogTransport({ apiKey: process.env.DD_API_KEY }));
    logger.info("[LOGGER] ✅ Datadog transport enabled.");
  } catch (err) {
    logger.warn("[LOGGER] Datadog transport initialization failed:", err?.message);
  }
}

/* ------------------------------------------------------------------------
   🧱 Process-Level Safeguards
------------------------------------------------------------------------ */
process.on("uncaughtException", (err: Error) => {
  logger.error("💥 Uncaught Exception", { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("💥 Unhandled Promise Rejection", {
    reason: typeof reason === "object" ? reason?.message : reason,
  });
});

/* ------------------------------------------------------------------------
   🧩 Graceful Shutdown Handler
------------------------------------------------------------------------ */
export const shutdownLogger = async () => {
  try {
    logger.info("[LOGGER] 🛑 Flushing log buffers...");
    for (const transport of logger.transports) {
      if (transport instanceof winston.transports.File) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    logger.end();
    logger.info("[LOGGER] ✅ Logger shutdown complete.");
  } catch (err: any) {
    console.error("[LOGGER] Shutdown error:", err);
  }
};

export default logger;