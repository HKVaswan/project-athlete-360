/**
 * src/routes/admin.ts
 * ------------------------------------------------------------------
 * Admin-only routes for global management of the platform.
 * Includes:
 *  - Viewing system stats (users, institutions, storage usage, etc.)
 *  - Managing institutions, coaches, or reports
 *  - Triggering maintenance operations (if needed)
 *  - Future-ready for billing, plan upgrades, and analytics
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import * as adminController from "../controllers/admin.controller";

const router = Router();

// 🔒 Secure all admin routes
router.use(requireAuth, requireRole("admin"));

/**
 * 🧾 Get overall platform statistics
 * e.g. number of users, active sessions, institution count, etc.
 */
router.get("/stats", adminController.getPlatformStats);

/**
 * 🏫 Manage institutions (list, deactivate, delete)
 */
router.get("/institutions", adminController.listInstitutions);
router.delete("/institutions/:id", adminController.deleteInstitution);

/**
 * 🧑‍🏫 Manage coaches and athletes globally
 */
router.get("/coaches", adminController.listCoaches);
router.get("/athletes", adminController.listAthletes);

/**
 * 🧩 Future: Manage subscription plans / usage limits
 */
router.get("/plans", adminController.getPlans);
router.post("/plans/assign/:institutionId", adminController.assignPlan);

/**
 * ⚙️ Trigger maintenance operations (optional, protected)
 * Example: system backup, user cleanup, etc.
 */
router.post("/maintenance/backup", adminController.triggerBackup);

export default router;