import { z } from "zod";

// ───────────────────────────────
// 🏫 Create Institution Schema
// ───────────────────────────────
export const createInstitutionSchema = z.object({
  name: z
    .string()
    .min(3, "Institution name must be at least 3 characters long")
    .max(100, "Institution name too long"),
  address: z.string().max(200).optional(),
  contactEmail: z
    .string()
    .email("Invalid email format")
    .optional(),
  contactNumber: z
    .string()
    .regex(/^\+?[0-9]{7,15}$/, "Invalid contact number format")
    .optional(),
  adminId: z.string().uuid("Valid admin ID required").optional(),
});

// ───────────────────────────────
// 👨‍🏫 Link Coach to Institution Schema
// ───────────────────────────────
export const linkCoachSchema = z.object({
  coachId: z.string().uuid("Valid coach ID required"),
  institutionCode: z
    .string()
    .min(6, "Invalid institution code format"),
});

// ───────────────────────────────
// 🧍 Athlete Join Institution Request Schema
// ───────────────────────────────
export const requestAthleteJoinSchema = z.object({
  userId: z.string().uuid("Valid user ID required"),
  institutionCode: z
    .string()
    .min(6, "Invalid institution code"),
});

// ───────────────────────────────
// ✅ Update Athlete Approval Schema
// ───────────────────────────────
export const updateAthleteApprovalSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  approverId: z.string().uuid("Valid approver ID required").optional(),
  approved: z.boolean(),
});

// ───────────────────────────────
// 🔍 Get Institution Query Schema (optional filters)
// ───────────────────────────────
export const institutionQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
});

// ───────────────────────────────
// 🧾 Get Institution by ID Schema
// ───────────────────────────────
export const institutionIdSchema = z.object({
  id: z.string().uuid("Invalid institution ID"),
});

// ───────────────────────────────
// 🧠 Type Exports for Reuse
// ───────────────────────────────
export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type LinkCoachInput = z.infer<typeof linkCoachSchema>;
export type RequestAthleteJoinInput = z.infer<typeof requestAthleteJoinSchema>;
export type UpdateAthleteApprovalInput = z.infer<typeof updateAthleteApprovalSchema>;
export type InstitutionQueryInput = z.infer<typeof institutionQuerySchema>;
export type InstitutionIdInput = z.infer<typeof institutionIdSchema>;