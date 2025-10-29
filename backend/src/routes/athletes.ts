/**
 * src/routes/athletes.ts
 * ---------------------------------------------------------
 * Athlete management routes
 * Roles: admin, coach, athlete
 * Handles registration, approvals, session & performance linking.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as athleteController from "../controllers/athletes.controller";
import {
  createAthleteSchema,
  updateAthleteSchema,
  recordCompetitionSchema,
  performanceSchema,
  sessionSchema,
} from "../validators/athletes.validator";

const router = Router();

/**
 * 🧾 Public (future extension)
 * Currently, athletes only register through institution process
 */
// router.post("/register", validate(createAthleteSchema), athleteController.createAthlete);

/**
 * 🔒 Authenticated Routes (Athlete, Coach, Admin)
 */
router.use(requireAuth);

/**
 * 👀 Get all athletes (admin & coach)
 * Supports filters — ?institutionId=, ?approved=, ?limit=, ?page=
 */
router.get(
  "/",
  requireRole(["admin", "coach"]),
  athleteController.getAthletes
);

/**
 * 👤 Get athlete by ID (full profile view)
 */
router.get(
  "/:id",
  requireRole(["admin", "coach", "athlete"]),
  athleteController.getAthleteById
);

/**
 * ➕ Create new athlete (usually by institution or admin)
 */
router.post(
  "/",
  requireRole(["admin", "coach"]),
  validate(createAthleteSchema),
  athleteController.createAthlete
);

/**
 * ✅ Approve athlete (only coach or admin)
 */
router.patch(
  "/:id/approve",
  requireRole(["coach", "admin"]),
  athleteController.approveAthlete
);

/**
 * ✏️ Update athlete details
 */
router.put(
  "/:id",
  requireRole(["admin", "coach", "athlete"]),
  validate(updateAthleteSchema),
  athleteController.updateAthlete
);

/**
 * ❌ Delete athlete (admin only)
 */
router.delete("/:id", requireRole("admin"), athleteController.deleteAthlete);

/**
 * 🏋️ Add training session for athlete
 */
router.post(
  "/:id/session",
  requireRole(["coach", "admin"]),
  validate(sessionSchema),
  athleteController.addTrainingSession
);

/**
 * 📊 Add performance metric (coach/admin)
 */
router.post(
  "/:id/performance",
  requireRole(["coach", "admin"]),
  validate(performanceSchema),
  athleteController.addPerformanceMetric
);

/**
 * 🏆 Record competition result
 */
router.post(
  "/competition/result",
  requireRole(["coach", "admin"]),
  validate(recordCompetitionSchema),
  athleteController.recordCompetitionResult
);

export default router;