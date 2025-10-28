import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import logger from "../logger";

/**
 * 🧠 Enterprise-grade Rate Limiting Middleware
 * Prevents brute-force, spam, and DoS attacks.
 * Adjustable per route type (auth endpoints vs. general APIs)
 */

// ───────────────────────────────
// 🔐 Strict rate limiter (for login, register, etc.)
// ───────────────────────────────
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per window
  message: {
    success: false,
    message:
      "Too many authentication attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable the deprecated X-RateLimit headers
  handler: (req: Request, res: Response, _next) => {
    logger.warn("Auth rate limit exceeded", {
      ip: req.ip,
      endpoint: req.originalUrl,
    });
    res.status(429).json({
      success: false,
      message:
        "Too many requests. Please wait a few minutes before trying again.",
    });
  },
});

// ───────────────────────────────
// 🌍 General rate limiter (for normal routes)
// ───────────────────────────────
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // allow 100 requests per IP per minute
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response, _next) => {
    logger.warn("General API rate limit exceeded", {
      ip: req.ip,
      endpoint: req.originalUrl,
    });
    res.status(429).json({
      success: false,
      message: "Rate limit exceeded. Try again later.",
    });
  },
});