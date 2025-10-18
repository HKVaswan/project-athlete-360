// src/routes/athletes.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getAthletes,
  getAthleteById,
  createAthlete,
  updateAthlete,
  deleteAthlete,
  addTrainingSession,
  addPerformanceMetric,
} from "../controllers/athletes.controller";

const router = Router();

// GET all athletes (admin/coach)
router.get("/", requireAuth, requireRole(["admin", "coach"]), getAthletes);

// GET athlete by ID (any authenticated)
router.get("/:id", requireAuth, getAthleteById);

// POST new athlete (admin/coach)
router.post("/", requireAuth, requireRole(["admin", "coach"]), createAthlete);

// PUT update athlete
router.put("/:id", requireAuth, requireRole(["admin", "coach"]), updateAthlete);

// DELETE athlete
router.delete("/:id", requireAuth, requireRole(["admin", "coach"]), deleteAthlete);

// POST training session under athlete
router.post("/:id/training-sessions", requireAuth, requireRole(["admin", "coach"]), addTrainingSession);

// POST performance metric under athlete
router.post("/:id/metrics", requireAuth, requireRole(["admin", "coach"]), addPerformanceMetric);

export default router;
