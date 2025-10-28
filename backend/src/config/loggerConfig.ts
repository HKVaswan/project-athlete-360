import winston from "winston";
import path from "path";
import fs from "fs";

// ───────────────────────────────
// 🧱 Ensure logs directory exists
// ───────────────────────────────
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// ───────────────────────────────
// 🧩 Define log format
// ───────────────────────────────
const logFormat = winston.format.printf(({ level, message, timestamp, stack, context }) => {
  const contextInfo = context ? ` [${context}]` : "";
  const stackTrace = stack ? `\n${stack}` : "";
  return `[${timestamp}] ${level.toUpperCase()}${contextInfo}: ${message}${stackTrace}`;
});

// ───────────────────────────────
// 🛠 Create transports
// ───────────────────────────────
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      logFormat
    ),
  }),

  // File transport for errors (rotating logs can be added later)
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),

  // File transport for all logs
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),
];

// ───────────────────────────────
// 🌍 Logger Configuration
// ───────────────────────────────
export const loggerConfig = {
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.errors({ stack: true }), // Capture stack traces
    winston.format.timestamp(),
    logFormat
  ),
  transports,
  exitOnError: false,
};

// ───────────────────────────────
// 🚀 Factory function for contextual logger
// ───────────────────────────────
export const createLogger = (context?: string) =>
  winston.createLogger({
    ...loggerConfig,
    defaultMeta: context ? { context } : {},
  });
