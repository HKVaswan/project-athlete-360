/**
 * src/utils/errors.ts
 * ----------------------------------------------
 * Centralized error management system
 * for consistent, secure, and debuggable APIs.
 */

export type ErrorSource = "system" | "database" | "validation" | "auth" | "forbidden" | "notfound";

/**
 * Base class for API errors.
 * Extends the native Error and adds standardized fields.
 */
export class ApiError extends Error {
  statusCode: number;
  source?: ErrorSource;
  isOperational: boolean;

  constructor(statusCode: number, message: string, source?: ErrorSource, isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.source = source;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Convenience error factories for common HTTP errors.
 */
export const BadRequestError = (message = "Bad Request", source: ErrorSource = "validation") =>
  new ApiError(400, message, source);

export const UnauthorizedError = (message = "Unauthorized", source: ErrorSource = "auth") =>
  new ApiError(401, message, source);

export const ForbiddenError = (message = "Forbidden", source: ErrorSource = "forbidden") =>
  new ApiError(403, message, source);

export const NotFoundError = (message = "Not Found", source: ErrorSource = "notfound") =>
  new ApiError(404, message, source);

export const ConflictError = (message = "Conflict", source: ErrorSource = "validation") =>
  new ApiError(409, message, source);

export const InternalServerError = (message = "Internal Server Error", source: ErrorSource = "system") =>
  new ApiError(500, message, source);

/**
 * Utility: Convert unknown error into ApiError
 * Ensures that thrown non-ApiError exceptions are safely transformed.
 */
export const normalizeError = (err: unknown): ApiError => {
  if (err instanceof ApiError) return err;

  if (err instanceof Error) {
    return new ApiError(500, err.message || "Unknown Error", "system", false);
  }

  return new ApiError(500, "Unexpected error occurred", "system", false);
};

/**
 * Utility: Graceful error response formatter
 * Avoids exposing sensitive info to client.
 */
export const formatErrorResponse = (err: ApiError, env: string) => {
  const base = {
    success: false,
    message: err.message,
    statusCode: err.statusCode,
  };

  // Include details only in development
  if (env === "development") {
    return {
      ...base,
      source: err.source,
      stack: err.stack,
    };
  }

  return base;
};