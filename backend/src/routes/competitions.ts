/**
 * src/routes/competitions.ts
 * ---------------------------------------------------------
 * Competition Management Routes
 * Roles: admin, coach
 * Features:
 *  - Create, list, and view competitions
 *  - Add athletes to competitions
 *  - Update results
 *  - View athlete’s past competitions
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as competitionController from "../controllers/competitions.controller";
import {
  createCompetitionSchema,
  addAthleteSchema,
  updateResultSchema,
} from "../validators/competitions.validator";

const router = Router();

/**
 * 🔒 All routes require authentication
 */
router.use(requireAuth);

/**
 * 🏆 Create a new competition (Admin or Coach)
 */
router.post(
  "/",
  requireRole(["admin", "coach"]),
  validate(createCompetitionSchema),
  competitionController.createCompetition
);

/**
 * 📋 Get all competitions (with filters: upcoming/past/institution)
 */
router.get("/", requireRole(["admin", "coach"]), competitionController.getCompetitions);

/**
 * 🔍 Get a single competition by ID (with participants)
 */
router.get("/:id", requireRole(["admin", "coach"]), competitionController.getCompetitionById);

/**
 * ➕ Add athlete to competition (coach/admin)
 */
router.post(
  "/add-athlete",
  requireRole(["admin", "coach"]),
  validate(addAthleteSchema),
  competitionController.addAthleteToCompetition
);

/**
 * 🥇 Update athlete’s result or performance in competition
 */
router.patch(
  "/update-result",
  requireRole(["admin", "coach"]),
  validate(updateResultSchema),
  competitionController.updateCompetitionResult
);

/**
 * ❌ Delete a competition (admin only)
 */
router.delete("/:id", requireRole("admin"), competitionController.deleteCompetition);

/**
 * 🏃 View all competitions an athlete has participated in
 */
router.get(
  "/athlete/:athleteId",
  requireRole(["admin", "coach", "athlete"]),
  competitionController.getAthleteCompetitions
);

export default router;