/**
 * src/routes/assessments.ts
 * ---------------------------------------------------------
 * Routes for managing athlete assessments (fitness, skill, body metrics, etc.)
 * Roles: Coach, Admin (create/update/delete), Athlete (view own)
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as assessmentController from "../controllers/assessments.controller";
import {
  createAssessmentSchema,
  updateAssessmentSchema,
} from "../validators/assessments.validator";

const router = Router();

/**
 * 🔒 All routes protected
 */
router.use(requireAuth);

/**
 * 🧪 Create a new assessment record for an athlete
 * Accessible by: Coach, Admin
 */
router.post(
  "/",
  requireRole(["coach", "admin"]),
  validate(createAssessmentSchema),
  assessmentController.createAssessment
);

/**
 * 📋 Get all assessments (with optional filters)
 * ?athleteId=, ?sessionId=, ?metric=
 * Accessible by: Coach, Admin, Athlete
 */
router.get(
  "/",
  requireRole(["coach", "admin", "athlete"]),
  assessmentController.getAssessments
);

/**
 * 🔍 Get a specific assessment by ID
 * Accessible by: all authenticated users linked to the same institution
 */
router.get(
  "/:id",
  requireRole(["coach", "admin", "athlete"]),
  assessmentController.getAssessmentById
);

/**
 * ✏️ Update assessment record
 * Accessible by: Coach, Admin
 */
router.patch(
  "/:id",
  requireRole(["coach", "admin"]),
  validate(updateAssessmentSchema),
  assessmentController.updateAssessment
);

/**
 * ❌ Delete assessment (Admin only)
 */
router.delete(
  "/:id",
  requireRole("admin"),
  assessmentController.deleteAssessment
);

export default router;