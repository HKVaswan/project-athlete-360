import { z } from "zod";

// ───────────────────────────────
// 🧍 Athlete Creation Schema
// ───────────────────────────────
export const athleteCreateSchema = z.object({
  userId: z.string().uuid("Valid user ID is required"),
  name: z.string().min(3, "Athlete name must be at least 3 characters long"),
  sport: z.string().min(2, "Sport is required"),
  dob: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: "Invalid date of birth format",
    }),
  gender: z.enum(["male", "female", "other"], {
    required_error: "Gender is required",
  }),
  contactInfo: z
    .object({
      phone: z
        .string()
        .min(10, "Phone must have at least 10 digits")
        .max(15, "Phone too long")
        .optional(),
      address: z.string().max(200).optional(),
    })
    .optional(),
  institutionId: z.string().uuid("Valid institution ID required"),
});

// ───────────────────────────────
// ✏️ Athlete Update Schema
// ───────────────────────────────
export const athleteUpdateSchema = z.object({
  name: z.string().min(3).optional(),
  sport: z.string().min(2).optional(),
  dob: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: "Invalid date format",
    }),
  gender: z.enum(["male", "female", "other"]).optional(),
  contactInfo: z
    .object({
      phone: z.string().min(10).max(15).optional(),
      address: z.string().max(200).optional(),
    })
    .optional(),
  approved: z.boolean().optional(),
  institutionId: z.string().uuid().optional(),
});

// ───────────────────────────────
// ✅ Approve Athlete Schema
// ───────────────────────────────
export const athleteApprovalSchema = z.object({
  id: z.string().uuid("Valid athlete ID required"),
  approverId: z.string().uuid("Approver ID required"),
});

// ───────────────────────────────
// 🏋️ Add Training Session Schema
// ───────────────────────────────
export const addSessionSchema = z.object({
  name: z.string().min(3, "Session name required"),
  date: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date" }),
  duration: z
    .number()
    .min(1, "Duration must be at least 1 minute")
    .max(480, "Duration too long")
    .optional(),
  notes: z.string().max(300).optional(),
});

// ───────────────────────────────
// 🧠 Add Performance Metric Schema
// ───────────────────────────────
export const performanceSchema = z.object({
  assessmentType: z.string().min(3, "Assessment type is required"),
  score: z
    .number()
    .positive("Score must be positive")
    .max(10000, "Unrealistic score value"),
  notes: z.string().max(300).optional(),
});

// ───────────────────────────────
// 🏆 Competition Result Schema
// ───────────────────────────────
export const competitionResultSchema = z.object({
  athleteId: z.string().uuid("Athlete ID is required"),
  competitionId: z.string().uuid("Competition ID is required"),
  result: z.string().max(100).optional(),
  position: z.number().int().min(1).max(100).optional(),
  performanceNotes: z.string().max(300).optional(),
});

// ───────────────────────────────
// 📊 Pagination & Filters
// ───────────────────────────────
export const athleteQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  approved: z.string().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
});

// ───────────────────────────────
// 🧠 Type Inference
// ───────────────────────────────
export type AthleteCreateInput = z.infer<typeof athleteCreateSchema>;
export type AthleteUpdateInput = z.infer<typeof athleteUpdateSchema>;
export type AthleteApprovalInput = z.infer<typeof athleteApprovalSchema>;
export type AddSessionInput = z.infer<typeof addSessionSchema>;
export type PerformanceInput = z.infer<typeof performanceSchema>;
export type CompetitionResultInput = z.infer<typeof competitionResultSchema>;
export type AthleteQueryInput = z.infer<typeof athleteQuerySchema>;