import express from "express";
import {
  createInstitution,
  listInstitutions,
  getInstitutionById,
  updateInstitution,
  deleteInstitution,
  assignCoachToInstitution,
  getInstitutionCoaches,
  getInstitutionAthletes,
  getInstitutionCompetitions,
} from "../controllers/institutions.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = express.Router();

/**
 * ───────────────────────────────
 * 🏫 Institution Routes
 * ───────────────────────────────
 */

// 🔒 Admin only — create new institution
router.post("/", requireAuth, createInstitution);

// 🌐 Public / Authenticated — list all institutions
router.get("/", listInstitutions);

// 🔍 Get a single institution with full details (coaches, athletes, competitions)
router.get("/:id", requireAuth, getInstitutionById);

// ✏️ Update institution info (Admin only)
router.put("/:id", requireAuth, updateInstitution);

// ❌ Delete institution (Admin only)
router.delete("/:id", requireAuth, deleteInstitution);

// 👨‍🏫 Assign coach to institution (Admin only)
router.post("/:id/assign-coach", requireAuth, assignCoachToInstitution);

// 🧑‍🏫 Get all coaches under an institution
router.get("/:id/coaches", requireAuth, getInstitutionCoaches);

// 🧍 Get all athletes under an institution
router.get("/:id/athletes", requireAuth, getInstitutionAthletes);

// 🏆 Get all competitions linked to an institution
router.get("/:id/competitions", requireAuth, getInstitutionCompetitions);

export default router;