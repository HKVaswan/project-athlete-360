/**
 * src/routes/analytics.ts
 * ------------------------------------------------------------------------
 * Analytics Routes (Enterprise-Grade)
 *
 * Exposes endpoints for system-wide metrics, trends, and performance analytics.
 * Secured by role-based access (Admin-only by default).
 * Designed to be AI-ready for predictive insights in the future.
 */

import express from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getAnalyticsOverview,
  getTrends,
  getPerformanceAnalytics,
} from "../controllers/analytics/analytics.controller";

const router = express.Router();

/**
 * @route   GET /api/analytics/overview
 * @desc    Get overall platform metrics (athletes, sessions, competitions, etc.)
 * @access  Admin only
 */
router.get("/overview", requireAuth, requireRole(["admin"]), getAnalyticsOverview);

/**
 * @route   GET /api/analytics/trends
 * @desc    Get system usage and activity trends
 * @access  Admin only
 */
router.get("/trends", requireAuth, requireRole(["admin"]), getTrends);

/**
 * @route   GET /api/analytics/performance
 * @desc    Get aggregated athlete performance statistics
 * @access  Admin & Coach
 */
router.get("/performance", requireAuth, requireRole(["admin", "coach"]), getPerformanceAnalytics);

export default router;