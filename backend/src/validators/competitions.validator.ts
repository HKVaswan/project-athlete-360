import { z } from "zod";

// ───────────────────────────────
// 🏆 Competition Creation
// ───────────────────────────────
export const competitionCreateSchema = z.object({
  name: z.string().min(3, "Competition name must be at least 3 characters long"),
  location: z.string().min(3, "Location is required"),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Start date must be a valid date",
  }),
  endDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: "End date must be a valid date",
    })
    .optional(),
  institutionId: z.string().uuid("Valid institution ID required"),
  description: z.string().max(500).optional(),
  type: z
    .enum(["local", "district", "state", "national", "international"])
    .default("local"),
  visibility: z.enum(["private", "public"]).default("private"),
});

// ───────────────────────────────
// 🧾 Competition Update Schema
// ───────────────────────────────
export const competitionUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  visibility: z.enum(["private", "public"]).optional(),
});

// ───────────────────────────────
// 🧍 Add Athlete to Competition
// ───────────────────────────────
export const addAthleteSchema = z.object({
  athleteId: z.string().uuid("Valid athlete ID required"),
  competitionId: z.string().uuid("Valid competition ID required"),
});

// ───────────────────────────────
// 🥇 Update Competition Result
// ───────────────────────────────
export const updateResultSchema = z.object({
  athleteId: z.string().uuid("Athlete ID is required"),
  competitionId: z.string().uuid("Competition ID is required"),
  result: z
    .string()
    .max(100, "Result must be a short description")
    .optional(),
  position: z
    .number()
    .int()
    .positive()
    .max(100, "Position must be within valid range")
    .optional(),
  performanceNotes: z.string().max(300).optional(),
});

// ───────────────────────────────
// 🔍 Query Filter (for listing)
// ───────────────────────────────
export const competitionQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  upcoming: z.string().optional(),
  past: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

// ───────────────────────────────
// 🧠 Type Inference
// ───────────────────────────────
export type CompetitionCreateInput = z.infer<typeof competitionCreateSchema>;
export type CompetitionUpdateInput = z.infer<typeof competitionUpdateSchema>;
export type AddAthleteInput = z.infer<typeof addAthleteSchema>;
export type UpdateResultInput = z.infer<typeof updateResultSchema>;
export type CompetitionQueryInput = z.infer<typeof competitionQuerySchema>;