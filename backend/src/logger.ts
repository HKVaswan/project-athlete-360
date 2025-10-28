import winston from "winston";
import path from "path";
import { loggerConfig } from "./config/loggerConfig";

const { combine, timestamp, printf, colorize, align, errors } = winston.format;

// ───────────────────────────────
// 🎨 Log Format
// ───────────────────────────────
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return stack
    ? `[${timestamp}] ${level}: ${message}\n${stack}`
    : `[${timestamp}] ${level}: ${message}`;
});

// ───────────────────────────────
// 🧠 Create Winston Logger
// ───────────────────────────────
export const logger = winston.createLogger({
  level: loggerConfig.level,
  format: combine(
    errors({ stack: true }), // capture stack traces
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    align(),
    logFormat
  ),
  defaultMeta: { service: "project-athlete-360-backend" },
  transports: [
    // 🖥 Console output for all environments
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: "HH:mm:ss" }),
        logFormat
      ),
    }),

    // 🗂 Persistent log files (for production)
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024, // 5MB per file
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join("logs", "combined.log"),
      maxsize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 5,
    }),
  ],
  exitOnError: false, // keep process alive on handled errors
});

// ───────────────────────────────
// 🚀 Stream for morgan (HTTP logging)
// ───────────────────────────────
export const morganStream = {
  write: (message: string) => logger.http(message.trim()),
};

// ───────────────────────────────
// 🛡 Graceful error listener
// ───────────────────────────────
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("UNHANDLED REJECTION:", reason);
});

// ───────────────────────────────
// ✅ Optional: Cloud / Sentry Integration
// (Future-ready for enterprise scalability)
// ───────────────────────────────
// Example (commented):
// import * as Sentry from "@sentry/node";
// Sentry.init({ dsn: process.env.SENTRY_DSN });
// logger.add(new SentryTransport(Sentry));
