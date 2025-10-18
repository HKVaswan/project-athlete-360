import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getPerformance, getPerformanceSummary } from "../controllers/performance.controller";

const router = Router();

router.get("/:athleteId", requireAuth, getPerformance);                   // GET /api/performance/:athleteId
router.get("/:athleteId/summary", requireAuth, getPerformanceSummary);   // GET /api/performance/:athleteId/summary

export default router;
