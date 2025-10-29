/**
 * src/routes/auth.ts
 * ---------------------------------------------------------
 * Authentication routes
 * Handles: register, login, refresh, logout, forgot/reset password
 * Uses: zod validation + rate limiting + role-based logic
 */

import { Router } from "express";
import { validate } from "../middleware/validation.middleware";
import { rateLimit } from "express-rate-limit";
import {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from "../controllers/auth.controller";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/auth.validator";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

/**
 * 🛡️ Security — Apply rate limiting on auth-sensitive endpoints
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20, // max requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

/**
 * 🧾 Public Routes
 * ---------------------------------------------------------
 * Registration, login, password resets, verification
 */
router.post("/register", authRateLimiter, validate(registerSchema), register);
router.post("/login", authRateLimiter, validate(loginSchema), login);
router.post("/refresh", refreshToken);
router.post("/logout", requireAuth, logout);

router.post(
  "/forgot-password",
  authRateLimiter,
  validate(forgotPasswordSchema),
  forgotPassword
);

router.post(
  "/reset-password",
  authRateLimiter,
  validate(resetPasswordSchema),
  resetPassword
);

router.get("/verify-email/:token", verifyEmail);

/**
 * ✅ Authenticated Route
 * For checking session status
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({
    success: true,
    message: "Authenticated user fetched successfully.",
    data: {
      id: (req as any).userId,
      username: (req as any).username,
      role: (req as any).role,
    },
  });
});

export default router;