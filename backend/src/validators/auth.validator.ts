import { z } from "zod";

// ───────────────────────────────
// 🧩 Auth Validation Schemas
// ───────────────────────────────

// Registration validation — for all roles (athlete, coach, admin)
export const registerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
  role: z.enum(["athlete", "coach", "admin"], {
    required_error: "Role is required",
  }),
  institutionCode: z
    .string()
    .optional()
    .or(z.literal("")), // optional for admin, required for athlete/coach (checked in controller)
  coachCode: z.string().optional(),
});

// Login validation
export const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});

// Password reset (forgot)
export const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
});

// Password update (reset)
export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
});

// Token refresh
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token required"),
});

// Email verification
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token required"),
});

// ───────────────────────────────
// ✅ Type Inference (auto TS support)
// ───────────────────────────────
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;