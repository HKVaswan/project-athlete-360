import { z } from "zod";

// ───────────────────────────────
// 🧍 Athlete Registration & Update
// ───────────────────────────────

// Basic athlete creation (by institution admin or self-registration via code)
export const athleteCreateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email address required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian phone number")
    .optional(),
  sport: z.string().min(2, "Sport name required"),
  gender: z.enum(["male", "female", "other"], { required_error: "Gender required" }),
  dateOfBirth: z
    .string()
    .refine((d) => !isNaN(Date.parse(d)), "Date of birth must be valid"),
  institutionCode: z.string().min(4, "Institution code required"),
  coachCode: z.string().optional(), // optional — can join later via invitation
  height: z.number().min(50).max(250).optional(),
  weight: z.number().min(20).max(200).optional(),
  bloodGroup: z.string().regex(/^(A|B|AB|O)[+-]$/, "Invalid blood group").optional(),
  profileImage: z.string().url("Must be a valid image URL").optional(),
});

// Update schema — partial version
export const athleteUpdateSchema = athleteCreateSchema.partial();

// ───────────────────────────────
// 🧑‍🏫 Assign Coach / Institution
// ───────────────────────────────
export const assignCoachSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  coachCode: z.string().min(4, "Valid coach code required"),
});

export const assignInstitutionSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  institutionCode: z.string().min(4, "Valid institution code required"),
});

// ───────────────────────────────
// 🔍 Query Filters for Athlete List
// ───────────────────────────────
export const athleteQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  coachId: z.string().uuid().optional(),
  sport: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  page: z.string().regex(/^\d+$/, "Page must be a number").optional(),
  limit: z.string().regex(/^\d+$/, "Limit must be a number").optional(),
});

// ───────────────────────────────
// 🧠 Type Inference
// ───────────────────────────────
export type AthleteCreateInput = z.infer<typeof athleteCreateSchema>;
export type AthleteUpdateInput = z.infer<typeof athleteUpdateSchema>;
export type AssignCoachInput = z.infer<typeof assignCoachSchema>;
export type AssignInstitutionInput = z.infer<typeof assignInstitutionSchema>;
export type AthleteQueryInput = z.infer<typeof athleteQuerySchema>;