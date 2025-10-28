import { z } from "zod";

// ───────────────────────────────
// 🏫 Institution Creation (Admin Registration Page)
// ───────────────────────────────
export const institutionCreateSchema = z.object({
  name: z.string().min(3, "Institution name must be at least 3 characters long"),
  address: z.string().min(10, "A valid address is required"),
  contactEmail: z.string().email("Valid email required"),
  contactNumber: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit contact number"),
  adminName: z.string().min(3, "Admin name required"),
  adminEmail: z.string().email("Valid admin email required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  planType: z.enum(["basic", "standard", "premium"], {
    required_error: "Please select a plan type",
  }),
  paymentReference: z.string().optional(), // for online payment verification (future use)
});

// ───────────────────────────────
// 🧾 Update Institution Details
// ───────────────────────────────
export const institutionUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  address: z.string().min(10).optional(),
  contactEmail: z.string().email().optional(),
  contactNumber: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter valid number")
    .optional(),
  logoUrl: z.string().url().optional(),
  description: z.string().max(500).optional(),
  website: z.string().url("Must be a valid URL").optional(),
});

// ───────────────────────────────
// 👨‍🏫 Link Coach to Institution
// ───────────────────────────────
export const linkCoachSchema = z.object({
  coachId: z.string().uuid("Valid coach ID required"),
  institutionCode: z.string().min(4, "Valid institution code required"),
});

// ───────────────────────────────
// 🧍 Athlete Join Request
// ───────────────────────────────
export const athleteJoinSchema = z.object({
  userId: z.string().uuid("Valid user ID required"),
  institutionCode: z.string().min(4, "Institution code is required"),
});

// ───────────────────────────────
// ✅ Approve or Reject Athlete
// ───────────────────────────────
export const athleteApprovalSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  approverId: z.string().uuid("Approver ID required"),
  approved: z.boolean(),
});

// ───────────────────────────────
// 🔍 Institution Query Filters
// ───────────────────────────────
export const institutionQuerySchema = z.object({
  search: z.string().optional(),
  planType: z.enum(["basic", "standard", "premium"]).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

// ───────────────────────────────
// 🧠 Type Inference
// ───────────────────────────────
export type InstitutionCreateInput = z.infer<typeof institutionCreateSchema>;
export type InstitutionUpdateInput = z.infer<typeof institutionUpdateSchema>;
export type LinkCoachInput = z.infer<typeof linkCoachSchema>;
export type AthleteJoinInput = z.infer<typeof athleteJoinSchema>;
export type AthleteApprovalInput = z.infer<typeof athleteApprovalSchema>;
export type InstitutionQueryInput = z.infer<typeof institutionQuerySchema>;