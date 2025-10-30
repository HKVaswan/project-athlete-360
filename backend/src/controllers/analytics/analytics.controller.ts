/**
 * src/controllers/analytics/analytics.controller.ts
 * ------------------------------------------------------------------------
 * Analytics Controller
 *
 * Provides endpoints for system-wide and institution-level insights.
 * Features:
 *  - Role-based access (admin, coach)
 *  - High-performance data retrieval
 *  - Future support for AI-generated insights
 */

import { Request, Response } from "express";
import { analyticsService } from "../../services/analytics.service";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { logger } from "../../logger";

export class AnalyticsController {
  /**
   * GET /api/analytics/overview
   * Returns system-wide overview metrics.
   */
  async getOverview(req: Request, res: Response) {
    try {
      const data = await analyticsService.getOverview();
      return res.status(200).json({
        success: true,
        message: "Analytics overview retrieved successfully.",
        data,
      });
    } catch (err) {
      logger.error("❌ AnalyticsController.getOverview failed:", err);
      return sendErrorResponse(res, err);
    }
  }

  /**
   * GET /api/analytics/trends
   * Returns monthly trend analytics (athletes, sessions, competitions)
   */
  async getTrends(req: Request, res: Response) {
    try {
      const trends = await analyticsService.getTrends();
      return res.status(200).json({
        success: true,
        message: "Analytics trends fetched successfully.",
        data: trends,
      });
    } catch (err) {
      logger.error("❌ AnalyticsController.getTrends failed:", err);
      return sendErrorResponse(res, err);
    }
  }

  /**
   * GET /api/analytics/performance
   * Returns aggregated athlete performance analytics.
   * Restricted to admins and coaches.
   */
  async getPerformanceAnalytics(req: Request, res: Response) {
    try {
      // Role enforcement (basic level, detailed check is in middleware)
      const userRole = (req as any).user?.role;
      if (!["admin", "coach"].includes(userRole)) {
        throw Errors.Forbidden("Access denied: Insufficient privileges.");
      }

      const data = await analyticsService.getPerformanceAnalytics();
      return res.status(200).json({
        success: true,
        message: "Performance analytics fetched successfully.",
        data,
      });
    } catch (err) {
      logger.error("❌ AnalyticsController.getPerformanceAnalytics failed:", err);
      return sendErrorResponse(res, err);
    }
  }
}

export const analyticsController = new AnalyticsController();