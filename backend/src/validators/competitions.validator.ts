import { z } from "zod";

// ───────────────────────────────
// 🏆 Competition Validation Schemas
// ───────────────────────────────

// Create a new competition
export const competitionCreateSchema = z.object({
  name: z.string().min(3, "Competition name must be at least 3 characters"),
  location: z.string().min(2, "Location is required"),
  startDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    "Start date must be a valid date"
  ),
  endDate: z
    .string()
    .refine(
      (date) => !isNaN(Date.parse(date)),
      "End date must be a valid date"
    )
    .optional(),
  institutionId: z.string().uuid("Valid institution ID required"),
  description: z.string().max(500, "Description too long").optional(),
  sportType: z.string().min(2, "Sport type required").optional(),
});

// Update competition (partial update)
export const competitionUpdateSchema = competitionCreateSchema.partial();

// ───────────────────────────────
// 🧍 Add Athlete to Competition
// ───────────────────────────────
export const addAthleteSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  competitionId: z.string().uuid("Valid competition ID required"),
});

// ───────────────────────────────
// 🥇 Update Result / Performance
// ───────────────────────────────
export const updateResultSchema = z.object({
  athleteId: z.string().uuid("Athlete ID required"),
  competitionId: z.string().uuid("Competition ID required"),
  result: z.string().max(100, "Result description too long").optional(),
  position: z
    .number()
    .int()
    .positive("Position must be a positive integer")
    .optional(),
  performanceNotes: z
    .string()
    .max(500, "Performance notes too long")
    .optional(),
});

// ───────────────────────────────
// 🔍 Query / Filter Competitions
// ───────────────────────────────
export const competitionQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  upcoming: z.enum(["true", "false"]).optional(),
  past: z.enum(["true", "false"]).optional(),
  page: z.string().regex(/^\d+$/, "Page must be a valid number").optional(),
  limit: z.string().regex(/^\d+$/, "Limit must be a valid number").optional(),
});

// ───────────────────────────────
// ✅ Type Inference
// ───────────────────────────────
export type CompetitionCreateInput = z.infer<typeof competitionCreateSchema>;
export type CompetitionUpdateInput = z.infer<typeof competitionUpdateSchema>;
export type AddAthleteInput = z.infer<typeof addAthleteSchema>;
export type UpdateResultInput = z.infer<typeof updateResultSchema>;
export type CompetitionQueryInput = z.infer<typeof competitionQuerySchema>;