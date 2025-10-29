/**
 * src/routes/performances.ts
 * ---------------------------------------------------------
 * Routes for managing athlete performance metrics.
 * Roles: Coach, Admin (write), Athlete (view own)
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as performanceController from "../controllers/performances.controller";
import {
  createPerformanceSchema,
  updatePerformanceSchema,
} from "../validators/performances.validator";

const router = Router();

/**
 * 🔒 All routes require authentication
 */
router.use(requireAuth);

/**
 * ➕ Record new performance entry
 * Accessible by: Coach, Admin
 */
router.post(
  "/",
  requireRole(["coach", "admin"]),
  validate(createPerformanceSchema),
  performanceController.createPerformance
);

/**
 * 📊 Get all performance records
 * Optional filters: ?athleteId=, ?sessionId=, ?dateRange=
 * Accessible by: Coach, Admin, Athlete
 */
router.get(
  "/",
  requireRole(["coach", "admin", "athlete"]),
  performanceController.getPerformances
);

/**
 * 🔍 Get a single performance entry by ID
 */
router.get(
  "/:id",
  requireRole(["coach", "admin", "athlete"]),
  performanceController.getPerformanceById
);

/**
 * ✏️ Update performance entry
 * Accessible by: Coach, Admin
 */
router.patch(
  "/:id",
  requireRole(["coach", "admin"]),
  validate(updatePerformanceSchema),
  performanceController.updatePerformance
);

/**
 * ❌ Delete a performance entry (Admin only)
 */
router.delete(
  "/:id",
  requireRole("admin"),
  performanceController.deletePerformance
);

export default router;