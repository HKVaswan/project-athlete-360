// src/logger.ts
import winston from "winston";
import path from "path";
import fs from "fs";

// ───────────────────────────────
// 📁 Ensure log directory exists
// ───────────────────────────────
const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ───────────────────────────────
// 🎨 Custom Log Format
// ───────────────────────────────
const logFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  const cleanMsg = stack || message;
  return `[${timestamp}] ${level.toUpperCase()}: ${cleanMsg}`;
});

// ───────────────────────────────
// ⚙️ Logger Configuration
// ───────────────────────────────
const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.errors({ stack: true }), // capture stack traces
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.splat(), // support printf placeholders
    logFormat
  ),
  transports: [
    // 🧾 All logs (info, warn, error)
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5 * 1024 * 1024, // 5MB per file
      maxFiles: 5,
    }),
    // ❌ Error-only logs
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
  exitOnError: false,
});

// ───────────────────────────────
// 🖥️ Console Output (dev-friendly)
// ───────────────────────────────
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        logFormat
      ),
    })
  );
}

// ───────────────────────────────
// 🌍 Optional: Integration Hooks
// ───────────────────────────────
// For external tools like Sentry, Loki, or Datadog
// logger.on('data', (log) => {
//   sendToExternalService(log);
// });

export default logger;

// Helper shortcuts (optional for convenience)
export const log = {
  info: (msg: string) => logger.info(msg),
  warn: (msg: string) => logger.warn(msg),
  error: (msg: string, err?: any) => {
    logger.error(`${msg} ${err?.stack || err || ""}`);
  },
  debug: (msg: string) => logger.debug(msg),
};