// src/lib/loggerEnhancer.ts
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import logger from "../logger";

/**
 * Attach correlation ID to every request for full traceability.
 */
export const attachRequestId = (req: Request, _res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  (req as any).requestId = requestId;
  req.headers["x-request-id"] = requestId;
  next();
};

/**
 * Enterprise request/response logging middleware.
 * Logs:
 *  - Request method, path, duration
 *  - Auth user ID (if available)
 *  - Correlation ID for tracing across jobs/workers
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req as any).requestId || randomUUID();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const userId = (req as any).user?.id || "unauthenticated";

    const logData = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      duration,
      userId,
    };

    if (status >= 500) logger.error(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logData);
    else if (status >= 400) logger.warn(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logData);
    else logger.info(`[HTTP ${status}] ${req.method} ${req.originalUrl}`, logData);
  });

  next();
};

/**
 * Express middleware to safely log only if response time exceeds threshold.
 * (Optional optimization)
 */
export const slowRequestMonitor = (thresholdMs = 1000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        logger.warn(`[SLOW] ${req.method} ${req.originalUrl} took ${duration}ms`, {
          duration,
          user: (req as any).user?.id,
        });
      }
    });
    next();
  };
};