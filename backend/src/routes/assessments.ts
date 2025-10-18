// src/routes/assessments.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getAssessments,
  createAssessment,
  updateAssessment,
  deleteAssessment,
} from "../controllers/assessments.controller";

const router = Router();

// List all or filtered assessments
router.get("/", requireAuth, getAssessments);

// Create new assessment
router.post("/", requireAuth, requireRole(["admin", "coach"]), createAssessment);

// Update assessment
router.put("/:id", requireAuth, requireRole(["admin", "coach"]), updateAssessment);

// Delete assessment
router.delete("/:id", requireAuth, requireRole(["admin", "coach"]), deleteAssessment);

export default router;
