import { z } from "zod";

// ───────────────────────────────
// 🧩 Athlete Validation Schemas
// ───────────────────────────────

// Athlete registration (used by admins/coaches or self with institution code)
export const athleteRegistrationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email is required"),
  age: z.number().int().min(10, "Age must be at least 10"),
  gender: z.enum(["male", "female", "other"], { required_error: "Gender required" }),
  sport: z.string().min(2, "Sport name required"),
  institutionCode: z.string().min(1, "Institution code is required"),
  coachCode: z.string().optional(),
  contactNumber: z
    .string()
    .regex(/^[0-9]{10}$/, "Phone must be a valid 10-digit number")
    .optional(),
  address: z.string().optional(),
  medicalConditions: z.string().optional(),
});

// Athlete profile update (partial updates allowed)
export const athleteUpdateSchema = athleteRegistrationSchema.partial();

// Athlete performance filter / search query
export const athleteQuerySchema = z.object({
  sport: z.string().optional(),
  coachId: z.string().uuid().optional(),
  institutionId: z.string().uuid().optional(),
  minAge: z.string().transform(Number).optional(),
  maxAge: z.string().transform(Number).optional(),
  search: z.string().optional(),
});

// Athlete progress record (used in sessions or assessments)
export const athleteProgressSchema = z.object({
  athleteId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  metric: z.string().min(1, "Metric name required"), // e.g. "Speed", "Endurance"
  value: z.number().min(0, "Value must be positive"),
  unit: z.string().optional(), // e.g. "km/h", "seconds"
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});

// ───────────────────────────────
// ✅ Type Inference
// ───────────────────────────────
export type AthleteRegistrationInput = z.infer<typeof athleteRegistrationSchema>;
export type AthleteUpdateInput = z.infer<typeof athleteUpdateSchema>;
export type AthleteQueryInput = z.infer<typeof athleteQuerySchema>;
export type AthleteProgressInput = z.infer<typeof athleteProgressSchema>;