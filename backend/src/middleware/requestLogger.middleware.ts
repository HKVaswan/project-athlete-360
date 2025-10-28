import { Request, Response, NextFunction } from "express";
import logger from "../logger";

// Utility: Color codes for console readability
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

// ───────────────────────────────
// 🛰️ Request Logger Middleware
// ───────────────────────────────
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = process.hrtime.bigint();

  // Capture original res.send to measure response time
  const originalSend = res.send.bind(res);
  res.send = (body?: any): Response => {
    const duration = Number(process.hrtime.bigint() - start) / 1_000_000; // in ms

    const method = `${colors.cyan}${req.method}${colors.reset}`;
    const url = `${colors.yellow}${req.originalUrl}${colors.reset}`;
    const statusColor =
      res.statusCode >= 500
        ? colors.red
        : res.statusCode >= 400
        ? colors.magenta
        : res.statusCode >= 300
        ? colors.yellow
        : colors.green;

    const logMessage = `${method} ${url} → ${statusColor}${res.statusCode}${colors.reset} (${duration.toFixed(
      1
    )}ms)`;

    if (process.env.NODE_ENV !== "test") logger.http(logMessage);

    return originalSend(body);
  };

  next();
};