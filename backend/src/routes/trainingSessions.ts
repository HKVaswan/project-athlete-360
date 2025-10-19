// src/routes/trainingSessions.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getTrainingSessions,
  getTrainingSessionById,
  createTrainingSession,
  updateTrainingSession,
  deleteTrainingSession,
  addAthleteToTrainingSession,
  addFeedbackToTrainingSession,
} from "../controllers/trainingSessions.controller";

const router = Router();

// Get all training sessions
router.get("/", requireAuth, getTrainingSessions);

// Get training session by ID
router.get("/:id", requireAuth, getTrainingSessionById);

// Create new training session
router.post("/", requireAuth, requireRole(["coach", "admin"]), createTrainingSession);

// Update training session
router.put("/:id", requireAuth, requireRole(["coach", "admin"]), updateTrainingSession);

// Delete training session
router.delete("/:id", requireAuth, requireRole(["coach", "admin"]), deleteTrainingSession);

// Add athlete to a training session
router.post("/:id/athletes", requireAuth, requireRole(["coach", "admin"]), addAthleteToTrainingSession);

// Add feedback or notes
router.post("/:id/feedback", requireAuth, requireRole(["coach", "admin"]), addFeedbackToTrainingSession);

export default router;
