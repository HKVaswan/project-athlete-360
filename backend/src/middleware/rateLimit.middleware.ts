import rateLimit from "express-rate-limit";
import logger from "../logger";

// ───────────────────────────────
// 🛡️ Global & Route-Specific Rate Limiters
// ───────────────────────────────

// 🔹 Generic limiter for most endpoints (safe default)
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per window
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(`[RATE LIMIT] Too many requests from ${req.ip}`);
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
    });
  },
});

// 🔹 Stricter limiter for sensitive routes (e.g. login/register)
export const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 attempts per 10 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`[RATE LIMIT - AUTH] Too many login/signup attempts from ${req.ip}`);
    return res.status(429).json({
      success: false,
      message: "Too many authentication attempts. Try again later.",
    });
  },
});

// 🔹 Aggressive limiter for critical endpoints (optional)
export const adminRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`[RATE LIMIT - ADMIN] Excessive admin requests from ${req.ip}`);
    return res.status(429).json({
      success: false,
      message: "Rate limit exceeded for admin endpoint.",
    });
  },
});