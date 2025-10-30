/**
 * src/controllers/analytics/analytics.controller.ts
 * ------------------------------------------------------------------------
 * Analytics Controller (Enterprise-Grade)
 *
 * Handles system-wide analytics and data aggregation.
 * Features:
 *  - Real-time metrics for admin dashboards
 *  - Historical trends for sessions, athletes, coaches, and performance
 *  - AI-ready structure for predictive analytics and insights
 *  - Error-safe async operations
 */

import { Request, Response } from "express";
import { prisma } from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";

/**
 * GET /api/analytics/overview
 * Provides global analytics summary
 */
export const getAnalyticsOverview = async (req: Request, res: Response) => {
  try {
    const [athletes, coaches, sessions, competitions] = await Promise.all([
      prisma.athlete.count(),
      prisma.user.count({ where: { role: "coach" } }),
      prisma.session.count(),
      prisma.competition.count(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totals: { athletes, coaches, sessions, competitions },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error("❌ Analytics overview error:", err);
    throw Errors.Server("Failed to fetch analytics overview.");
  }
};

/**
 * GET /api/analytics/trends
 * Provides time-series performance and session trends
 */
export const getTrends = async (req: Request, res: Response) => {
  try {
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const [sessionTrends, competitionTrends] = await Promise.all([
      prisma.session.groupBy({
        by: ["date"],
        _count: true,
        where: { date: { gte: last30Days } },
        orderBy: { date: "asc" },
      }),
      prisma.competition.groupBy({
        by: ["startDate"],
        _count: true,
        where: { startDate: { gte: last30Days } },
        orderBy: { startDate: "asc" },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: { sessionTrends, competitionTrends },
    });
  } catch (err: any) {
    logger.error("❌ Analytics trends error:", err);
    throw Errors.Server("Failed to fetch analytics trends.");
  }
};

/**
 * GET /api/analytics/performance
 * Aggregated athlete performance analytics
 */
export const getPerformanceAnalytics = async (req: Request, res: Response) => {
  try {
    const performances = await prisma.performance.findMany({
      select: {
        athleteId: true,
        score: true,
        category: true,
        date: true,
      },
    });

    // Compute averages by category
    const categoryStats = performances.reduce<Record<string, { total: number; count: number }>>(
      (acc, p) => {
        if (!acc[p.category]) acc[p.category] = { total: 0, count: 0 };
        acc[p.category].total += p.score ?? 0;
        acc[p.category].count += 1;
        return acc;
      },
      {}
    );

    const summary = Object.entries(categoryStats).map(([category, data]) => ({
      category,
      averageScore: Number((data.total / data.count).toFixed(2)),
    }));

    return res.status(200).json({
      success: true,
      data: { summary, totalRecords: performances.length },
    });
  } catch (err: any) {
    logger.error("❌ Analytics performance error:", err);
    throw Errors.Server("Failed to compute performance analytics.");
  }
};