// src/utils/errors.ts
/**
 * Centralized error handling system for the platform.
 * ----------------------------------------------------
 *  - Defines a unified ApiError class for safe client responses.
 *  - Supports structured error codes for maintainability.
 *  - Prevents leaking internal server details.
 *  - Works seamlessly with error.middleware.ts for clean output.
 */

import type { Response } from "express";

/**
 * Enumerated error codes for consistency across the backend.
 * Each error type has a clear purpose and message.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  RATE_LIMIT: "RATE_LIMIT",
  BAD_REQUEST: "BAD_REQUEST",
  SERVER_ERROR: "SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * A consistent structure for API errors.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    code: ErrorCode = ErrorCodes.SERVER_ERROR,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Marks errors safe to return to clients
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Build standard response shape for middleware */
  toJSON() {
    return {
      success: false,
      message: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Helper: Unified error response sender
 * Can be used directly in controllers (if needed).
 */
export const sendErrorResponse = (res: Response, error: any) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json(error.toJSON());
  }

  // Fallback for unexpected or non-ApiError exceptions
  console.error("⚠️ Unexpected Error:", error);

  return res.status(500).json({
    success: false,
    message: "An unexpected error occurred.",
    code: ErrorCodes.SERVER_ERROR,
  });
};

/**
 * Factory helpers — improve readability in services/controllers
 */
export const Errors = {
  Validation: (msg = "Validation failed", details?: any) =>
    new ApiError(400, msg, ErrorCodes.VALIDATION_ERROR, details),

  Auth: (msg = "Authentication failed") =>
    new ApiError(401, msg, ErrorCodes.AUTH_ERROR),

  Forbidden: (msg = "Access denied") =>
    new ApiError(403, msg, ErrorCodes.FORBIDDEN),

  NotFound: (msg = "Resource not found") =>
    new ApiError(404, msg, ErrorCodes.NOT_FOUND),

  Duplicate: (msg = "Duplicate entry") =>
    new ApiError(409, msg, ErrorCodes.DUPLICATE),

  RateLimit: (msg = "Too many requests") =>
    new ApiError(429, msg, ErrorCodes.RATE_LIMIT),

  BadRequest: (msg = "Invalid request", details?: any) =>
    new ApiError(400, msg, ErrorCodes.BAD_REQUEST, details),

  Server: (msg = "Internal server error") =>
    new ApiError(500, msg, ErrorCodes.SERVER_ERROR),

  ServiceUnavailable: (msg = "Service temporarily unavailable") =>
    new ApiError(503, msg, ErrorCodes.SERVICE_UNAVAILABLE),
};