// src/routes/athletes.ts
import express from "express";
import {
  getAthletes,
  getAthleteById,
  createAthlete,
  updateAthlete,
  deleteAthlete,
  addTrainingSession,
  addPerformanceMetric,
  approveAthlete,
  getPendingAthletes,
  getAthleteCompetitions,
} from "../controllers/athletes.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = express.Router();

/**
 * 🧾 Athletes API Routes
 * Base path: /api/athletes
 */

// Public / role-agnostic routes (for dashboards, etc.)
router.get("/", requireAuth, getAthletes);
router.get("/:id", requireAuth, getAthleteById);

// CRUD operations (protected)
router.post("/", requireAuth, createAthlete);
router.put("/:id", requireAuth, updateAthlete);
router.delete("/:id", requireAuth, deleteAthlete);

// Athlete-specific actions
router.post("/:id/sessions", requireAuth, addTrainingSession);
router.post("/:id/performance", requireAuth, addPerformanceMetric);

// 🔒 Admin / Coach Only Actions
router.get("/pending/all", requireAuth, getPendingAthletes); // View unapproved athletes
router.post("/:id/approve", requireAuth, approveAthlete); // Approve athlete (by coach/admin)

// 🏟️ Competitions
router.get("/:id/competitions", requireAuth, getAthleteCompetitions); // Get all competitions of athlete

export default router;