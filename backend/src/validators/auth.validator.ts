import { z } from "zod";

/**
 * auth.validator.ts
 * ---------------------------------------------------------------------
 * Enterprise-grade validation for authentication flows.
 * Includes advanced rules for Super Admin / System Admin onboarding.
 */

// ───────────────────────────────
// 🧩 Registration Validation (All Roles)
// ───────────────────────────────

export const registerSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Valid email is required"),
    password: z
      .string()
      .min(10, "Password must be at least 10 characters long")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[a-z]/, "Must contain at least one lowercase letter")
      .regex(/[0-9]/, "Must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Must contain at least one special character"),

    role: z.enum(["athlete", "coach", "admin", "super_admin"], {
      required_error: "Role is required",
    }),

    institutionCode: z
      .string()
      .optional()
      .or(z.literal("")), // optional for admin/super_admin

    coachCode: z.string().optional(),

    // Super Admin creation safeguard
    systemPassphrase: z
      .string()
      .optional()
      .describe(
        "Required only for super_admin onboarding (enterprise root verification)."
      ),

    mfaToken: z
      .string()
      .optional()
      .describe("Temporary MFA token for secure admin/super_admin setup."),
  })
  .superRefine((data, ctx) => {
    // Enforce stronger logic per role
    if (["athlete", "coach"].includes(data.role) && !data.institutionCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Institution code is required for athletes and coaches.",
      });
    }

    // Super Admin cannot self-register without passphrase
    if (data.role === "super_admin" && !data.systemPassphrase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "System passphrase is required for Super Admin registration (restricted route).",
      });
    }
  });

// ───────────────────────────────
// 🔑 Login Validation
// ───────────────────────────────
export const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
  mfaToken: z.string().optional(), // for super_admin or admin login
});

// ───────────────────────────────
// 🔁 Password Reset
// ───────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token required"),
  newPassword: z
    .string()
    .min(10, "Password must be at least 10 characters long")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Must contain at least one special character"),
});

// ───────────────────────────────
// 🔄 Token Refresh
// ───────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token required"),
});

// ───────────────────────────────
// 📧 Email Verification
// ───────────────────────────────
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token required"),
});

// ───────────────────────────────
// ✅ Type Exports (Auto TS Inference)
// ───────────────────────────────
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;