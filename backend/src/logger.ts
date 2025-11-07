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
 *  - Ready for future integrations (Sentry, Datadog, Loki)
 * ---------------------------------------------------------------------------
 */

import winston from "winston";
import path from "path";
import fs from "fs";
import { trace, context } from "@opentelemetry/api";
import { config } from "./config";
import { loggerConfig } from "./config/loggerConfig";

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

/* ------------------------------------------------------------------------
   🧱 JSON Log Format (for ELK/Loki)
------------------------------------------------------------------------ */
const jsonFormat = winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const activeSpan = trace.getSpan(context.active());
  const traceContext = activeSpan?.spanContext();

  const logData = {
    timestamp,
    level,
    message,
    ...(stack ? { stack } : {}),
    traceId: traceContext?.traceId || null,
    spanId: traceContext?.spanId || null,
    service: config.serviceName || "pa360-backend",
    env: config.nodeEnv || process.env.NODE_ENV || "development",
    region: config.region || "global",
    version: config.version || "1.0.0",
    pid: process.pid,
    hostname: require("os").hostname(),
    ...meta,
  };

  return JSON.stringify(logData);
});

/* ------------------------------------------------------------------------
   🧰 Winston Logger Setup
------------------------------------------------------------------------ */
export const logger = winston.createLogger({
  level: loggerConfig.level || "info",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    jsonFormat
  ),
  defaultMeta: {
    service: config.serviceName || "backend",
  },
  transports: [
    // ─── Console (colorized output for local debugging) ───
    new winston.transports.Console({
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),

    // ─── Error File Logs ───
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true,
    }),

    // ─── Combined Logs ───
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 10,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

/* ------------------------------------------------------------------------
   🌐 Stream (for Express + Morgan HTTP logging)
------------------------------------------------------------------------ */
export const morganStream = {
  write: (message: string) => logger.info(message.trim(), { source: "http" }),
};

/* ------------------------------------------------------------------------
   🛡️ Global Process-Level Error Handling
------------------------------------------------------------------------ */
process.on("uncaughtException", (err: Error) => {
  logger.error("💥 Uncaught Exception", {
    error: err.message,
    stack: err.stack,
  });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("💥 Unhandled Promise Rejection", {
    reason: typeof reason === "object" ? reason?.message : reason,
  });
});

/* ------------------------------------------------------------------------
   🧩 Graceful Shutdown
------------------------------------------------------------------------ */
export const shutdownLogger = async () => {
  try {
    logger.info("🛑 Flushing and shutting down logger...");
    for (const transport of logger.transports) {
      if (transport instanceof winston.transports.File) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    logger.end();
    logger.info("✅ Logger shutdown complete.");
  } catch (err: any) {
    console.error("[LOGGER] Shutdown error:", err);
  }
};

/* ------------------------------------------------------------------------
   ☁️ Future Integrations (Optional)
------------------------------------------------------------------------ */
// Example (Sentry):
// import * as Sentry from "@sentry/node";
// Sentry.init({ dsn: process.env.SENTRY_DSN });
// logger.add(new SentryTransport(Sentry));

// Example (Datadog):
// import { DatadogTransport } from "datadog-winston";
// logger.add(new DatadogTransport({ apiKey: process.env.DD_API_KEY }));

/* ------------------------------------------------------------------------
   📦 Export
------------------------------------------------------------------------ */
export default logger;