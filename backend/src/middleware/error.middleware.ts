// src/middleware/error.middleware.ts
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import logger from "../logger";
import { ApiError, ErrorCodes } from "../utils/errors";
import * as Sentry from "@sentry/node";

interface ExtendedError extends Error {
  statusCode?: number;
  details?: any;
  code?: string;
  meta?: any;
  isOperational?: boolean;
}

/**
 * 🛡️ Centralized Enterprise Error Handler
 * Handles:
 *  - Operational errors (ApiError)
 *  - ORM / Prisma errors
 *  - Validation & parsing errors
 *  - Internal server crashes (safe mode)
 *  - Emits structured logs & telemetry
 */
export const errorHandler = (
  err: ExtendedError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const isProd = process.env.NODE_ENV === "production";
  const errorId = randomUUID(); // 🔍 Unique traceable error ID

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let code = err.code || ErrorCodes.SERVER_ERROR;
  let details = err.details;

  // Prisma / ORM error mapping
  if (err.code === "P2002") {
    statusCode = 409;
    message = "Duplicate record – unique constraint failed";
    code = ErrorCodes.DUPLICATE;
  } else if (err.code === "P2025") {
    statusCode = 404;
    message = "Record not found";
    code = ErrorCodes.NOT_FOUND;
  }

  // Joi / Zod / Yup validation
  if (err.name === "ValidationError" || (err as any).isJoi || (err as any).issues) {
    statusCode = 400;
    message = "Validation failed";
    details = (err as any).details ?? (err as any).issues ?? err.message;
    code = ErrorCodes.VALIDATION_ERROR;
  }

  // Handle JWT / Auth errors
  if (message.toLowerCase().includes("jwt") || code === "AUTH_ERROR") {
    statusCode = 401;
    code = ErrorCodes.AUTH_ERROR;
    message = "Authentication failed or session expired.";
  }

  // Sanitize internal messages in production
  if (isProd && statusCode >= 500) {
    message = "An unexpected server error occurred.";
  }

  // Log structured entry
  logger.error(`[${errorId}] ${req.method} ${req.originalUrl} → ${statusCode} :: ${message}`, {
    errorId,
    user: (req as any).user?.id || "unauthenticated",
    code,
    details,
    ip: req.ip,
    stack: isProd ? undefined : err.stack,
  });

  // Optional telemetry
  try {
    Sentry.captureException(err, {
      tags: { route: req.originalUrl, method: req.method },
      extra: { errorId, user: (req as any).user?.id || "guest" },
    });
  } catch {}

  // Final safe JSON response
  res.status(statusCode).json({
    success: false,
    message,
    code,
    errorId,
    ...(details && !isProd ? { details } : {}),
  });
};

/**
 * 🧭 404 Not Found Handler (Fallback)
 */
export const notFoundHandler = (req: Request, res: Response) => {
  const errorId = randomUUID();
  logger.warn(`[${errorId}] 404 Not Found → ${req.originalUrl}`);

  res.status(404).json({
    success: false,
    message: "Resource not found",
    errorId,
  });
};