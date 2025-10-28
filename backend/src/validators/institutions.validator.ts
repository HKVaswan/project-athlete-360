import { z } from "zod";

// ───────────────────────────────
// 🏫 Institution Validation Schemas
// ───────────────────────────────

// Institution creation (for new admins)
export const institutionCreateSchema = z.object({
  name: z.string().min(3, "Institution name must be at least 3 characters"),
  email: z.string().email("A valid institution email is required"),
  contactNumber: z
    .string()
    .regex(/^[0-9]{10}$/, "Phone must be a valid 10-digit number")
    .optional(),
  address: z.string().min(5, "Address must be at least 5 characters"),
  city: z.string().min(2, "City name required"),
  state: z.string().min(2, "State name required"),
  country: z.string().default("India"),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit pincode").optional(),
  website: z.string().url("Provide a valid website URL").optional(),
  adminName: z.string().min(2, "Admin name required"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  planId: z.string().uuid("Plan ID required").optional(), // for paid subscription linking
});

// Institution update schema (partial updates allowed)
export const institutionUpdateSchema = institutionCreateSchema.partial();

// ───────────────────────────────
// 🧑‍🏫 Coach Linking / Approval Schemas
// ───────────────────────────────
export const coachLinkSchema = z.object({
  institutionId: z.string().uuid(),
  coachEmail: z.string().email(),
  role: z.enum(["coach", "assistantCoach"]).default("coach"),
});

export const coachApprovalSchema = z.object({
  coachId: z.string().uuid(),
  approved: z.boolean(),
});

// ───────────────────────────────
// 💳 Institution Billing / Plan Upgrade
// ───────────────────────────────
export const institutionPlanUpdateSchema = z.object({
  institutionId: z.string().uuid(),
  newPlanId: z.string().uuid(),
  paymentReference: z.string().optional(),
});

// ───────────────────────────────
// ✅ Type Inference
// ───────────────────────────────
export type InstitutionCreateInput = z.infer<typeof institutionCreateSchema>;
export type InstitutionUpdateInput = z.infer<typeof institutionUpdateSchema>;
export type CoachLinkInput = z.infer<typeof coachLinkSchema>;
export type CoachApprovalInput = z.infer<typeof coachApprovalSchema>;
export type InstitutionPlanUpdateInput = z.infer<typeof institutionPlanUpdateSchema>;