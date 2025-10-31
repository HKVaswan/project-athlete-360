// src/validators/superAdmin.validator.ts
/**
 * superAdmin.validator.ts
 * ----------------------------------------------------------------------
 * Validation schemas for all Super Admin operations.
 *
 * Covers:
 *  - System control (backup/restore)
 *  - Audit log queries
 *  - Impersonation
 *  - Secret management
 *  - MFA and authentication
 *
 * Enforces strict validation for critical parameters,
 * preventing injection, unauthorized restores, and unsafe inputs.
 * ----------------------------------------------------------------------
 */

import { z } from "zod";

// ───────────────────────────────
// 🔐 AUTH & MFA VALIDATION
// ───────────────────────────────
export const superAdminLoginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

export const verifyMFASchema = z.object({
  email: z.string().email("Valid email required"),
  code: z
    .string()
    .regex(/^\d{6}$/, "MFA code must be a 6-digit number")
    .length(6, "MFA code must be 6 digits"),
});

export const resendMFASchema = z.object({
  email: z.string().email("Valid email required"),
});

// ───────────────────────────────
// 🖥 SYSTEM CONTROL VALIDATION
// ───────────────────────────────
export const triggerBackupSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, {
    message: "Backup confirmation required.",
  }),
});

export const restoreBackupSchema = z.object({
  s3Key: z
    .string()
    .min(10, "Valid backup key (s3Key) is required.")
    .regex(/^backups\//, "s3Key must point to a valid backups path."),
  confirm: z
    .boolean()
    .refine((v) => v === true, { message: "Explicit confirmation required." }),
});

// ───────────────────────────────
// 📜 AUDIT LOGS VALIDATION
// ───────────────────────────────
export const auditLogQuerySchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// ───────────────────────────────
// 🧍 IMPERSONATION VALIDATION
// ───────────────────────────────
export const startImpersonationSchema = z.object({
  targetUserId: z
    .string()
    .uuid("Target user ID must be a valid UUID.")
    .min(10, "User ID is required."),
  reason: z
    .string()
    .min(10, "Impersonation reason required.")
    .max(250, "Reason too long."),
});

export const stopImpersonationSchema = z.object({
  sessionId: z.string().uuid("Valid impersonation session ID required."),
});

// ───────────────────────────────
// 🔑 SECRET MANAGEMENT VALIDATION
// ───────────────────────────────
export const createSecretSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z0-9_]+$/, "Key must be uppercase and use underscores (e.g. SERVICE_API_KEY)")
    .min(5)
    .max(60),
  value: z
    .string()
    .min(5, "Secret value is too short.")
    .max(500, "Secret value too long."),
  description: z.string().max(200).optional(),
  category: z.enum(["infrastructure", "ai", "security", "misc"]).default("misc"),
});

export const deleteSecretSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z0-9_]+$/, "Invalid secret key format.")
    .min(3),
});

// ───────────────────────────────
// 🧠 SYSTEM ANALYTICS VALIDATION
// ───────────────────────────────
export const systemOverviewQuerySchema = z.object({
  includeMetrics: z.boolean().optional().default(false),
  includeAlerts: z.boolean().optional().default(true),
});

// ───────────────────────────────
// ✅ TYPE EXPORTS
// ───────────────────────────────
export type SuperAdminLoginInput = z.infer<typeof superAdminLoginSchema>;
export type VerifyMFAInput = z.infer<typeof verifyMFASchema>;
export type RestoreBackupInput = z.infer<typeof restoreBackupSchema>;
export type StartImpersonationInput = z.infer<typeof startImpersonationSchema>;
export type CreateSecretInput = z.infer<typeof createSecretSchema>;
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;