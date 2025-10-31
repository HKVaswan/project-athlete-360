// src/utils/errors.ts
/**
 * Centralized enterprise-grade error handling system.
 * ---------------------------------------------------
 *  - Defines unified ApiError with granular codes.
 *  - Includes security + privilege-level events for Super Admin.
 *  - Works with global middleware & telemetry.
 */

import type { Response } from "express";
import logger from "../logger";

/**
 * Enumerated error codes (expanded for security and governance)
 */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  FORBIDDEN: "FORBIDDEN",
  PRIVILEGE_VIOLATION: "PRIVILEGE_VIOLATION",
  AUDIT_TRIGGER: "AUDIT_TRIGGER",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  RATE_LIMIT: "RATE_LIMIT",
  BAD_REQUEST: "BAD_REQUEST",
  SERVER_ERROR: "SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  DATA_INTEGRITY: "DATA_INTEGRITY",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Core API Error Class
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly isOperational: boolean;
  public readonly context?: string;

  constructor(
    statusCode: number,
    message: string,
    code: ErrorCode = ErrorCodes.SERVER_ERROR,
    details?: any,
    context?: string
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.context = context;
    this.isOperational = true;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Safe serialization for client responses */
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
 * 🧠 Helper: unified error response sender
 */
export const sendErrorResponse = (res: Response, error: any) => {
  if (error instanceof ApiError) {
    // Log privileged/security errors immediately
    if (
      [ErrorCodes.PRIVILEGE_VIOLATION, ErrorCodes.AUDIT_TRIGGER].includes(
        error.code
      )
    ) {
      logger.error(`[SECURITY ALERT] ${error.message}`, {
        code: error.code,
        details: error.details,
      });
    }

    return res.status(error.statusCode).json(error.toJSON());
  }

  // Fallback for unexpected exceptions
  logger.error("⚠️ Unexpected Error", {
    message: error?.message || error,
    stack: error?.stack,
  });

  return res.status(500).json({
    success: false,
    message: "An unexpected internal error occurred.",
    code: ErrorCodes.SERVER_ERROR,
  });
};

/**
 * 🚀 Factory helpers — consistent error creation across controllers/services
 */
export const Errors = {
  Validation: (msg = "Validation failed", details?: any) =>
    new ApiError(400, msg, ErrorCodes.VALIDATION_ERROR, details),

  Auth: (msg = "Authentication failed") =>
    new ApiError(401, msg, ErrorCodes.AUTH_ERROR),

  TokenExpired: (msg = "Session expired, please login again") =>
    new ApiError(401, msg, ErrorCodes.TOKEN_EXPIRED),

  Forbidden: (msg = "Access denied") =>
    new ApiError(403, msg, ErrorCodes.FORBIDDEN),

  PrivilegeViolation: (msg = "Insufficient privilege for this action", details?: any) =>
    new ApiError(403, msg, ErrorCodes.PRIVILEGE_VIOLATION, details),

  AuditTrigger: (msg = "Administrative action requires review", details?: any) =>
    new ApiError(202, msg, ErrorCodes.AUDIT_TRIGGER, details),

  NotFound: (msg = "Resource not found") =>
    new ApiError(404, msg, ErrorCodes.NOT_FOUND),

  Duplicate: (msg = "Duplicate entry") =>
    new ApiError(409, msg, ErrorCodes.DUPLICATE),

  RateLimit: (msg = "Too many requests") =>
    new ApiError(429, msg, ErrorCodes.RATE_LIMIT),

  BadRequest: (msg = "Invalid request", details?: any) =>
    new ApiError(400, msg, ErrorCodes.BAD_REQUEST, details),

  DataIntegrity: (msg = "Data integrity violation", details?: any) =>
    new ApiError(409, msg, ErrorCodes.DATA_INTEGRITY, details),

  Server: (msg = "Internal server error") =>
    new ApiError(500, msg, ErrorCodes.SERVER_ERROR),

  ServiceUnavailable: (msg = "Service temporarily unavailable") =>
    new ApiError(503, msg, ErrorCodes.SERVICE_UNAVAILABLE),
};