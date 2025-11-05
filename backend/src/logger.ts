/**
 * src/logger.ts
 * ---------------------------------------------------------------------------
 * 🧠 Enterprise Logger (Winston + OpenTelemetry integrated)
 *
 * Features:
 *  - Structured JSON logs for ELK / Grafana Loki
 *  - Includes traceId, spanId, service, environment, version, and region
 *  - Safe for concurrent workers and microservices
 *  - Auto-handles exceptions and rejections gracefully
 *  - Ready for future cloud transports (Sentry, Datadog, etc.)
 * ---------------------------------------------------------------------------
 */

import winston from "winston";
import path from "path";
import fs from "fs";
import { trace, context } from "@opentelemetry/api";
import { loggerConfig } from "./config/loggerConfig";
import { config } from "./config";

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ───────────────────────────────────────────────
// 🎨 JSON Log Format (enterprise standard)
// ───────────────────────────────────────────────
const jsonFormat = winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
  // Inject OpenTelemetry trace context
  const activeSpan = trace.getSpan(context.active());
  const traceContext = activeSpan ? activeSpan.spanContext() : undefined;

  const logPayload = {
    ts: timestamp,
    level,
    message,
    ...(stack ? { stack } : {}),
    traceId: traceContext?.traceId || null,
    spanId: traceContext?.spanId || null,
    service: config.serviceName || "project-athlete-360-backend",
    env: config.nodeEnv || "development",
    region: config.region || "global",
    version: config.version || "1.0.0",
    pid: process.pid,
    ...meta,
  };

  return JSON.stringify(logPayload);
});

// ───────────────────────────────────────────────
// 🧩 Winston Base Logger
// ───────────────────────────────────────────────
export const logger = winston.createLogger({
  level: loggerConfig.level || "info",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    jsonFormat
  ),
  defaultMeta: { service: config.serviceName || "backend" },
  transports: [
    // ✅ Console output (colorized for local dev)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      ),
    }),

    // ✅ Persistent error logs
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 10,
      tailable: true,
    }),

    // ✅ Combined application logs
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 20 * 1024 * 1024,
      maxFiles: 10,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

// ───────────────────────────────────────────────
// 🌐 Morgan Stream (for Express HTTP middleware)
// ───────────────────────────────────────────────
export const morganStream = {
  write: (message: string) => logger.info(message.trim(), { source: "morgan" }),
};

// ───────────────────────────────────────────────
// 🛡️ Global Error Capture (with graceful degradation)
// ───────────────────────────────────────────────
process.on("uncaughtException", (err: Error) => {
  logger.error("❌ Uncaught Exception", { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("❌ Unhandled Promise Rejection", {
    reason: typeof reason === "object" ? reason?.message : reason,
  });
});

// ───────────────────────────────────────────────
// 🔧 Optional Cloud/Third-Party Integration (Future)
// ───────────────────────────────────────────────
//
// Example:
// import * as Sentry from "@sentry/node";
// Sentry.init({ dsn: process.env.SENTRY_DSN });
// logger.add(new SentryTransport(Sentry));
//
// Example Datadog:
// import { DatadogTransport } from "datadog-winston";
// logger.add(new DatadogTransport({ apiKey: process.env.DD_API_KEY }));
//
// ───────────────────────────────────────────────

// ✅ Graceful shutdown
export const shutdownLogger = async () => {
  logger.info("🛑 Flushing and shutting down logger...");
  for (const transport of logger.transports) {
    if (transport instanceof winston.transports.File) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  logger.end();
};