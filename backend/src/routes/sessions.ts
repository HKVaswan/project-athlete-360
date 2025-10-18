// src/routes/sessions.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
} from "../controllers/sessions.controller";

const router = Router();

// List sessions (admin/coach)
router.get("/", requireAuth, requireRole(["admin", "coach"]), getSessions);

// Get session by ID
router.get("/:id", requireAuth, getSessionById);

// Create new session
router.post("/", requireAuth, requireRole(["admin", "coach"]), createSession);

// Update session
router.put("/:id", requireAuth, requireRole(["admin", "coach"]), updateSession);

// Delete session
router.delete("/:id", requireAuth, requireRole(["admin", "coach"]), deleteSession);

export default router;
