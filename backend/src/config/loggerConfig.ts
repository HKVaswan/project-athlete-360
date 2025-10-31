// src/config/loggerConfig.ts
import winston from "winston";
import path from "path";
import fs from "fs";
import { format } from "winston";

/**
 * 🧱 Ensure logs directory exists
 */
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

/**
 * 🧩 Sanitize sensitive fields (JWTs, tokens, passwords)
 */
const sanitize = (msg: string): string =>
  msg
    .replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, "[REDACTED_TOKEN]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .replace(/apikey=\S+/gi, "apikey=[REDACTED]");

/**
 * 🧠 Custom log format with structured context
 */
const logFormat = format.printf(({ level, message, timestamp, stack, context, user, role, ip, sessionId }) => {
  const base = `[${timestamp}] ${level.toUpperCase()}`;
  const ctx = context ? ` [${context}]` : "";
  const actor = user ? ` (user=${user}${role ? `, role=${role}` : ""})` : "";
  const meta = ip ? ` [ip=${ip}${sessionId ? `, session=${sessionId}` : ""}]` : "";
  const stackTrace = stack ? `\n${stack}` : "";
  return `${base}${ctx}${actor}${meta}: ${sanitize(message)}${stackTrace}`;
});

/**
 * 🛠 Define transports
 */
const transports: winston.transport[] = [
  new winston.transports.Console({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      logFormat
    ),
  }),

  // 🔴 Security log for privileged or critical actions
  new winston.transports.File({
    filename: path.join(logsDir, "security.log"),
    level: "warn", // Only warn/error (e.g., privilege escalations)
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  }),

  // ⚠️ Error logs
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  }),

  // 📜 Combined logs
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  }),
];

/**
 * 🌍 Base logger configuration
 */
export const loggerConfig = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    logFormat
  ),
  transports,
  exitOnError: false,
};

/**
 * 🚀 Factory function for contextual logger
 * @param context module or service name
 */
export const createLogger = (context?: string) =>
  winston.createLogger({
    ...loggerConfig,
    defaultMeta: context ? { context } : {},
  });

/**
 * 🧩 Helper for privileged / super admin logging
 * Logs sensitive actions (role changes, data deletion, etc.)
 */
export const logPrivilegedAction = ({
  userId,
  role,
  action,
  resource,
  ip,
}: {
  userId: string;
  role: string;
  action: string;
  resource?: string;
  ip?: string;
}) => {
  const logger = createLogger("SuperAdmin");
  const tag = role === "super_admin" ? "[PRIVILEGED]" : "[ADMIN]";
  logger.warn(`${tag} ${action} on ${resource || "system"} by ${userId}`, {
    user: userId,
    role,
    ip,
  });
};