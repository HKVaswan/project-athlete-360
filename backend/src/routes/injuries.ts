/**
 * src/routes/injuries.ts
 * ---------------------------------------------------------
 * Manages injury records and rehabilitation tracking.
 * Ensures:
 *  - Secure creation, updates, and viewing of injury data.
 *  - Coaches and admins can help monitor athlete recovery.
 *  - Full validation and rate limiting to prevent spam/abuse.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import * as injuriesController from "../controllers/injuries.controller";
import rateLimit from "express-rate-limit";
import { validate } from "../middleware/validation.middleware";
import { injurySchema } from "../validators/injuries.validator";

const router = Router();

/**
 * 🚦 Rate limiter to prevent spamming health logs.
 */
const injuryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 operations/minute/IP
  message: "Too many injury record operations. Please slow down.",
});

// 🔒 All injury routes require authentication
router.use(requireAuth);

/**
 * 🧑‍🎓 Athletes — Log a new injury record.
 * Requires: type, severity, date, description, etc.
 */
router.post(
  "/",
  requireRole("athlete"),
  injuryLimiter,
  validate(injurySchema.create),
  injuriesController.createInjuryRecord
);

/**
 * 🧑‍🎓 Athletes — View their own injury history.
 */
router.get(
  "/my",
  requireRole("athlete"),
  injuryLimiter,
  injuriesController.getMyInjuries
);

/**
 * 🧑‍🏫 Coaches — View injuries of assigned athletes only.
 */
router.get(
  "/coach/athletes",
  requireRole("coach"),
  injuryLimiter,
  injuriesController.getAthletesInjuries
);

/**
 * 🏥 Coaches — Update injury recovery progress notes.
 * (E.g., “Physiotherapy session completed”, “Cleared for training”)
 */
router.patch(
  "/:injuryId/progress",
  requireRole("coach"),
  injuryLimiter,
  validate(injurySchema.updateProgress),
  injuriesController.updateInjuryProgress
);

/**
 * 🧾 Admin — View all injuries across the institution (for compliance or medical support)
 */
router.get(
  "/admin/all",
  requireRole("admin"),
  injuryLimiter,
  injuriesController.getAllInjuries
);

/**
 * 🧹 Admin — Delete invalid or duplicate injury entries (soft delete)
 */
router.delete(
  "/admin/:injuryId",
  requireRole("admin"),
  injuriesController.deleteInjuryRecord
);

export default router;