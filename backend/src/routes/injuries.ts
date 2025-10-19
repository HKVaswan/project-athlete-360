// src/routes/injuries.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getInjuries,
  getInjuryById,
  createInjury,
  updateInjury,
  deleteInjury,
} from "../controllers/injuries.controller";

const router = Router();

// Get all injuries (admin/coach)
router.get("/", requireAuth, requireRole(["admin", "coach"]), getInjuries);

// Get single injury record (athlete or admin)
router.get("/:id", requireAuth, getInjuryById);

// Add new injury record
router.post("/", requireAuth, requireRole(["admin", "coach"]), createInjury);

// Update injury
router.put("/:id", requireAuth, requireRole(["admin", "coach"]), updateInjury);

// Delete injury record
router.delete("/:id", requireAuth, requireRole(["admin", "coach"]), deleteInjury);

export default router;
