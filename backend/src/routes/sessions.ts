/**
 * src/routes/sessions.ts
 * ---------------------------------------------------------
 * Handles training sessions, attendance, and performance notes.
 * Roles: coach, admin (manage); athlete (view only)
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as sessionController from "../controllers/sessions.controller";
import {
  createSessionSchema,
  updateSessionSchema,
  addAttendanceSchema,
} from "../validators/sessions.validator";

const router = Router();

/**
 * 🔒 All routes require authentication
 */
router.use(requireAuth);

/**
 * 🏋️ Create a new training session
 * Accessible by: Coach, Admin
 */
router.post(
  "/",
  requireRole(["coach", "admin"]),
  validate(createSessionSchema),
  sessionController.createSession
);

/**
 * 📋 Get all sessions (filter by athleteId, institutionId, date)
 * Accessible by: Coach, Admin, Athlete
 */
router.get("/", requireRole(["coach", "admin", "athlete"]), sessionController.getSessions);

/**
 * 🔍 Get single session by ID
 * Accessible by: all authenticated users in same institution
 */
router.get("/:id", requireRole(["coach", "admin", "athlete"]), sessionController.getSessionById);

/**
 * ✏️ Update session details (time, notes, etc.)
 * Accessible by: Coach, Admin
 */
router.patch(
  "/:id",
  requireRole(["coach", "admin"]),
  validate(updateSessionSchema),
  sessionController.updateSession
);

/**
 * 🧾 Mark attendance for a session
 * Accessible by: Coach, Admin
 */
router.post(
  "/:id/attendance",
  requireRole(["coach", "admin"]),
  validate(addAttendanceSchema),
  sessionController.markAttendance
);

/**
 * ❌ Delete session (Admin only)
 */
router.delete("/:id", requireRole("admin"), sessionController.deleteSession);

export default router;