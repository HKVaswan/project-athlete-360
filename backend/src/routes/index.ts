/**
 * src/routes/index.ts
 * ---------------------------------------------------------
 * Centralized route registration.
 * Automatically mounts all feature routes with versioning.
 * Adds clean structure for scalability and maintainability.
 */

import { Router } from "express";

import authRoutes from "./auth";
import athleteRoutes from "./athletes";
import institutionRoutes from "./institutions";
import competitionRoutes from "./competitions";
import sessionRoutes from "./sessions";
import assessmentRoutes from "./assessments";
import performanceRoutes from "./performances";
import attendanceRoutes from "./attendance";
import injuryRoutes from "./injuries";
import messageRoutes from "./messages";
import resourceRoutes from "./resources";
import invitationRoutes from "./invitations";
import adminRoutes from "./admin";

const router = Router();

// 🌐 API Version prefix (future-proofing)
const API_PREFIX = "/v1";

// 🚏 Register all routes here
router.use(`${API_PREFIX}/auth`, authRoutes);
router.use(`${API_PREFIX}/athletes`, athleteRoutes);
router.use(`${API_PREFIX}/institutions`, institutionRoutes);
router.use(`${API_PREFIX}/competitions`, competitionRoutes);
router.use(`${API_PREFIX}/sessions`, sessionRoutes);
router.use(`${API_PREFIX}/assessments`, assessmentRoutes);
router.use(`${API_PREFIX}/performances`, performanceRoutes);
router.use(`${API_PREFIX}/attendance`, attendanceRoutes);
router.use(`${API_PREFIX}/injuries`, injuryRoutes);
router.use(`${API_PREFIX}/messages`, messageRoutes);
router.use(`${API_PREFIX}/resources`, resourceRoutes);
router.use(`${API_PREFIX}/invitations`, invitationRoutes);
router.use(`${API_PREFIX}/admin`, adminRoutes);

// 🔁 Fallback for undefined endpoints
router.use("*", (_req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    availableRoutes: [
      "auth",
      "athletes",
      "institutions",
      "competitions",
      "sessions",
      "assessments",
      "performances",
      "attendance",
      "injuries",
      "messages",
      "resources",
      "invitations",
      "admin",
    ],
  });
});

export default router;