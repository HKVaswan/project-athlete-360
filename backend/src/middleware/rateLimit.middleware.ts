import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import logger from "../logger";

/**
 * 🛡️ Global API Rate Limiter
 * Protects public endpoints like /auth, /register, /login, etc.
 *
 * You can attach this middleware globally or per route.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`🚫 Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message:
        "Too many requests from this IP. Please try again after 15 minutes.",
    });
  },
});

/**
 * 🔐 Stricter limiter for authentication endpoints
 * Helps prevent brute-force login or registration spam.
 */
export const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // Limit each IP to 10 login/register attempts
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`🚫 Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message:
        "Too many authentication attempts. Please wait before trying again.",
    });
  },
});

/**
 * 🧩 Example Usage:
 *
 * import { authRateLimiter } from "../middleware/rateLimit.middleware";
 * router.post("/login", authRateLimiter, loginController);
 *
 * // or globally in app.ts:
 * app.use(globalRateLimiter);
 */