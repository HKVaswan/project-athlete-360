import { z } from "zod";

// ───────────────────────────────
// 🏆 Create Competition Schema
// ───────────────────────────────
export const createCompetitionSchema = z.object({
  name: z
    .string()
    .min(3, "Competition name must be at least 3 characters long")
    .max(100, "Competition name too long"),
  location: z.string().max(150).optional(),
  startDate: z
    .string()
    .refine((date) => !isNaN(Date.parse(date)), "Invalid start date format"),
  endDate: z
    .string()
    .optional()
    .refine((date) => !date || !isNaN(Date.parse(date)), "Invalid end date format"),
  institutionId: z.string().uuid("Invalid institution ID").optional(),
});

// ───────────────────────────────
// 🔍 Competition Query (filters, pagination)
// ───────────────────────────────
export const competitionQuerySchema = z.object({
  institutionId: z.string().uuid("Invalid institution ID").optional(),
  upcoming: z.enum(["true", "false"]).optional(),
  past: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
});

// ───────────────────────────────
// 🎯 Add Athlete to Competition
// ───────────────────────────────
export const addAthleteToCompetitionSchema = z.object({
  athleteId: z.string().uuid("Invalid athlete ID"),
  competitionId: z.string().uuid("Invalid competition ID"),
});

// ───────────────────────────────
// 🥇 Update Competition Result
// ───────────────────────────────
export const updateCompetitionResultSchema = z.object({
  athleteId: z.string().uuid("Invalid athlete ID"),
  competitionId: z.string().uuid("Invalid competition ID"),
  result: z.string().min(1, "Result cannot be empty").optional(),
  position: z
    .number({
      required_error: "Position must be a number",
      invalid_type_error: "Position must be numeric",
    })
    .int()
    .positive()
    .optional(),
  performanceNotes: z.string().max(500).optional(),
});

// ───────────────────────────────
// 🔎 Get Competition by ID
// ───────────────────────────────
export const competitionIdSchema = z.object({
  id: z.string().uuid("Invalid competition ID"),
});

// ───────────────────────────────
// 🏃 Get Athlete Competitions
// ───────────────────────────────
export const athleteCompetitionSchema = z.object({
  athleteId: z.string().uuid("Invalid athlete ID"),
});

// ───────────────────────────────
// 🧠 Type Exports
// ───────────────────────────────
export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;
export type CompetitionQueryInput = z.infer<typeof competitionQuerySchema>;
export type AddAthleteToCompetitionInput = z.infer<typeof addAthleteToCompetitionSchema>;
export type UpdateCompetitionResultInput = z.infer<typeof updateCompetitionResultSchema>;
export type CompetitionIdInput = z.infer<typeof competitionIdSchema>;
export type AthleteCompetitionInput = z.infer<typeof athleteCompetitionSchema>;