/**
 * src/routes/institutions.ts
 * ---------------------------------------------------------
 * Institution & Admin Management Routes
 * Roles: admin, coach
 * Features:
 *  - Create / List institutions
 *  - Link coaches
 *  - Handle athlete join requests & approvals
 *  - Institution detail view
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as institutionController from "../controllers/institutions.controller";
import {
  createInstitutionSchema,
  linkCoachSchema,
  requestJoinSchema,
  updateAthleteApprovalSchema,
} from "../validators/institutions.validator";

const router = Router();

/**
 * 🔒 All routes protected by authentication
 */
router.use(requireAuth);

/**
 * 🏫 Create a new institution (Admin only)
 */
router.post(
  "/",
  requireRole("admin"),
  validate(createInstitutionSchema),
  institutionController.createInstitution
);

/**
 * 📋 Get all institutions (Admin & Coach)
 */
router.get(
  "/",
  requireRole(["admin", "coach"]),
  institutionController.listInstitutions
);

/**
 * 👨‍🏫 Link a coach to an institution
 */
router.post(
  "/link-coach",
  requireRole("admin"),
  validate(linkCoachSchema),
  institutionController.linkCoachToInstitution
);

/**
 * 🧍 Athlete requests to join institution
 */
router.post(
  "/athlete/join",
  requireRole("athlete"),
  validate(requestJoinSchema),
  institutionController.requestAthleteJoin
);

/**
 * ✅ Approve or reject athlete join request
 */
router.patch(
  "/athlete/approval",
  requireRole(["coach", "admin"]),
  validate(updateAthleteApprovalSchema),
  institutionController.updateAthleteApproval
);

/**
 * 🔍 Get institution details (with coaches, athletes, competitions)
 */
router.get(
  "/:id",
  requireRole(["admin", "coach"]),
  institutionController.getInstitutionById
);

export default router;