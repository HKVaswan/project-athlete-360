// src/middleware/error.middleware.ts
import { Request, Response, NextFunction } from "express";
import logger from "../logger";
import { ApiError, ErrorCodes } from "../utils/errors";

/**
 * Extended interface to support operational errors and Prisma-like ones
 */
interface ExtendedError extends Error {
  statusCode?: number;
  details?: any;
  code?: string;
  meta?: any;
}

/**
 * 🛡️ Centralized Error Handler (Enterprise-Grade)
 * Handles:
 *  - Standard API errors
 *  - Prisma DB errors
 *  - Unexpected internal failures
 *  - Structured logging & non-leaky responses
 */
export const errorHandler = (
  err: ExtendedError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const isProd = process.env.NODE_ENV === "production";
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";
  let details = err.details;
  let code = (err as any).code || ErrorCodes.SERVER_ERROR;

  // Prisma known errors (avoid leaking internal info)
  if (err.code === "P2002") {
    statusCode = 409;
    message = "Duplicate record – unique constraint failed";
    code = ErrorCodes.DUPLICATE;
  } else if (err.code === "P2025") {
    statusCode = 404;
    message = "Record not found";
    code = ErrorCodes.NOT_FOUND;
  }

  // Validation errors
  if (err.name === "ValidationError" || (err as any).isJoi || (err as any).issues) {
    statusCode = 400;
    message = "Validation failed";
    details = (err as any).details ?? (err as any).issues ?? err.message;
    code = ErrorCodes.VALIDATION_ERROR;
  }

  // Compose structured response
  const responseBody = {
    success: false,
    message,
    code,
    ...(details ? { details } : {}),
    ...(isProd ? {} : { stack: err.stack }),
  };

  // Structured log
  logger.error(`${req.method} ${req.originalUrl} → ${statusCode} :: ${message}`, {
    statusCode,
    code,
    details,
    user: (req as any).user?.id || "unauthenticated",
    stack: err.stack,
  });

  return res.status(statusCode).json(responseBody);
};

/**
 * 🧭 Not Found Handler (Fallback)
 */
export const notFoundHandler = (req: Request, res: Response) => {
  logger.warn(`404 Not Found → ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Resource not found",
  });
};