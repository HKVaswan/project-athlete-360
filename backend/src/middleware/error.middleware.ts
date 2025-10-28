import { Request, Response, NextFunction } from "express";
import logger from "../logger";

interface ApiError extends Error {
  statusCode?: number;
  details?: any;
}

// ───────────────────────────────
// 🛡️ Centralized Error Handler
// ───────────────────────────────
export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === "production";

  const errorResponse = {
    success: false,
    message: err.message || "Internal Server Error",
    ...(err.details ? { details: err.details } : {}),
    ...(isProd ? {} : { stack: err.stack }),
  };

  // Structured logging
  logger.error(
    `${req.method} ${req.originalUrl} → ${statusCode} :: ${err.message}`,
    {
      stack: err.stack,
      details: err.details,
      user: (req as any).user?.id || "unauthenticated",
    }
  );

  res.status(statusCode).json(errorResponse);
};

// ───────────────────────────────
// 🧩 Not Found Handler
// ───────────────────────────────
export const notFoundHandler = (req: Request, res: Response) => {
  logger.warn(`404 Not Found: ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Resource not found",
  });
};