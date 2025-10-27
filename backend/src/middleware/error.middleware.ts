// src/middleware/error.middleware.ts
import { Request, Response, NextFunction } from "express";
import logger from "../logger";

/**
 * 🌐 Global Error Handler Middleware
 * Handles all application-level and async errors gracefully.
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";

  // Log detailed error (always)
  logger.error(
    `[ERROR] ${req.method} ${req.path} | ${err.name || "Error"}: ${err.message}`
  );
  if (!isProd) {
    console.error("🔍 Stack Trace:", err.stack);
  }

  // Prevent leaking internal details in production
  const message =
    status === 500 && isProd
      ? "Internal Server Error"
      : err.message || "Something went wrong";

  // Send JSON error response
  return res.status(status).json({
    success: false,
    status,
    message,
    ...(isProd ? {} : { stack: err.stack }),
  });
};

/**
 * 🧱 NotFoundHandler
 * Handles 404 routes that don't exist
 */
export const notFoundHandler = (req: Request, res: Response) => {
  logger.warn(`[404] Route not found: ${req.method} ${req.path}`);
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
};