/**
 * src/routes/admin/analytics.ts
 * ---------------------------------------------------------------------------
 * Routes for Admin Analytics & Insights
 *
 * Provides secure endpoints for:
 *  - Platform statistics
 *  - Growth trends
 *  - Engagement metrics
 *  - AI insights (future-ready)
 *
 * Access: Admin only
 */

import { Router } from "express";
import {
  getPlatformStats,
  getUserGrowthTrends,
  getEngagementMetrics,
  getAiInsights,
} from "../../controllers/admin/analytics.controller";

import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/roles.middleware";

const router = Router();

/**
 * Middleware chain:
 *  - requireAuth → checks JWT & user validity
 *  - requireRole('admin') → restricts to admin only
 */
router.use(requireAuth, requireRole("admin"));

// 🧩 Core analytics routes
router.get("/stats", getPlatformStats);
router.get("/growth-trends", getUserGrowthTrends);
router.get("/engagement", getEngagementMetrics);

// 🤖 AI insights (placeholder — future integration)
router.get("/ai-insights", getAiInsights);

export default router;