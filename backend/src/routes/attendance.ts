// src/routes/attendance.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  markAttendance,
  getAttendanceBySession,
  updateAttendance,
  deleteAttendance,
} from "../controllers/attendance.controller";

const router = Router();

// Mark attendance (Coach/Admin)
router.post("/", requireAuth, requireRole(["coach", "admin"]), markAttendance);

// Get all attendance for a session
router.get("/session/:sessionId", requireAuth, getAttendanceBySession);

// Update attendance record
router.put("/:id", requireAuth, requireRole(["coach", "admin"]), updateAttendance);

// Delete attendance
router.delete("/:id", requireAuth, requireRole(["coach", "admin"]), deleteAttendance);

export default router;
