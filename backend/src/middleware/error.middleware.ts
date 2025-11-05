/**
 * src/middleware/error.middleware.ts
 * ---------------------------------------------------------------------------
 * 🛡️ Centralized Enterprise Error Handler
 *
 * Handles:
 *  - Operational (expected) and unexpected errors
 *  - ORM / Prisma / Validation / Auth errors
 *  - Captures metrics, audit logs, and Sentry traces
 *  - Responds with consistent, secure JSON API structure
 *
 * Integrations:
 *  - Winston (structured logs)
 *  - Sentry (critical exception tracking)
 *  - Telemetry (error rate & type metrics)
 *  - Audit Service (optional for severe ops alerts)
 * ---------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import * as Sentry from "@sentry/node";
import { logger } from "../logger";
import { telemetry } from "../lib/telemetry";
import { recordError } from "../lib/core/metrics";
import { ErrorCodes, ApiError } from "../utils/errors";
import { auditService } from "../lib/audit";

interface ExtendedError extends Error {
  statusCode?: number;
  details?: any;
  code?: string;
  meta?: Record<string, any>;
  isOperational?: boolean;
}

/* -----------------------------------------------------------------------
   🧠 Error Handler Middleware
------------------------------------------------------------------------ */
export const errorHandler = (
  err: ExtendedError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const isProd = process.env.NODE_ENV === "production";
  const errorId = randomUUID();
  const userId = (req as any).user?.id || "unauthenticated";

  // Normalize defaults
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let code = err.code || ErrorCodes.SERVER_ERROR;
  let details = err.details || null;

  /* -----------------------------------------------------------------------
     🔍 Error Classification
  ------------------------------------------------------------------------ */

  // Prisma / ORM
  switch (err.code) {
    case "P2002":
      statusCode = 409;
      message = "Duplicate record — unique constraint failed.";
      code = ErrorCodes.DUPLICATE;
      break;
    case "P2025":
      statusCode = 404;
      message = "Record not found.";
      code = ErrorCodes.NOT_FOUND;
      break;
  }

  // Validation frameworks (Zod / Joi / Yup)
  if (err.name === "ValidationError" || (err as any).isJoi || (err as any).issues) {
    statusCode = 400;
    code = ErrorCodes.VALIDATION_ERROR;
    message = "Validation failed. Please check input.";
    details = (err as any).details ?? (err as any).issues ?? err.message;
  }

  // Auth / JWT / Session
  if (message.toLowerCase().includes("jwt") || code === "AUTH_ERROR") {
    statusCode = 401;
    code = ErrorCodes.AUTH_ERROR;
    message = "Authentication failed or session expired.";
  }

  // Network / External service timeout
  if (message.toLowerCase().includes("timeout")) {
    statusCode = 504;
    code = ErrorCodes.TIMEOUT;
    message = "External service timeout. Please retry later.";
  }

  // Hide internal stack messages in production
  if (isProd && statusCode >= 500) {
    message = "An unexpected server error occurred.";
    details = undefined;
  }

  /* -----------------------------------------------------------------------
     🧩 Structured Logging
  ------------------------------------------------------------------------ */
  logger.error(`[ERROR ${statusCode}] ${req.method} ${req.originalUrl}`, {
    errorId,
    userId,
    code,
    statusCode,
    ip: req.ip,
    method: req.method,
    route: req.originalUrl,
    message: err.message,
    stack: isProd ? undefined : err.stack,
    meta: err.meta,
  });

  /* -----------------------------------------------------------------------
     📊 Telemetry + Metrics
  ------------------------------------------------------------------------ */
  recordError(code || "unknown", statusCode >= 500 ? "high" : "medium");
  telemetry.record("errors.total", 1, "counter", {
    code: code || "unknown",
    route: req.originalUrl,
    method: req.method,
  });

  /* -----------------------------------------------------------------------
     🧾 Sentry (Critical errors only)
  ------------------------------------------------------------------------ */
  try {
    if (statusCode >= 500 || !err.isOperational) {
      Sentry.captureException(err, {
        tags: { route: req.originalUrl, method: req.method },
        extra: { errorId, userId, code },
      });
    }
  } catch {}

  /* -----------------------------------------------------------------------
     📋 Audit Log (for system reliability reports)
  ------------------------------------------------------------------------ */
  if (statusCode >= 500) {
    auditService
      .log({
        actorId: userId,
        actorRole: "system",
        action: "SYSTEM_ERROR",
        details: {
          route: req.originalUrl,
          errorId,
          message: err.message,
          code,
          stack: isProd ? undefined : err.stack,
        },
      })
      .catch(() => {});
  }

  /* -----------------------------------------------------------------------
     🚀 Final Safe JSON Response
  ------------------------------------------------------------------------ */
  return res.status(statusCode).json({
    success: false,
    errorId,
    message,
    code,
    ...(details && !isProd ? { details } : {}),
  });
};

/* -----------------------------------------------------------------------
   🧭 404 Fallback Handler
------------------------------------------------------------------------ */
export const notFoundHandler = (req: Request, res: Response) => {
  const errorId = randomUUID();

  logger.warn(`[404] ${req.method} ${req.originalUrl}`, {
    errorId,
    ip: req.ip,
  });

  return res.status(404).json({
    success: false,
    message: "Resource not found",
    errorId,
  });
};