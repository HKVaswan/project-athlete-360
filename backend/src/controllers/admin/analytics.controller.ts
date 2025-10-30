/**
 * src/controllers/admin/analytics.controller.ts
 * ---------------------------------------------------------------------------
 * Admin Analytics Controller
 *
 * Provides:
 *  - Platform-wide metrics (athletes, coaches, sessions, competitions)
 *  - Growth trends & performance insights
 *  - AI-ready hook for predictive analytics (later integration)
 *
 * Security:
 *  - Admin-only access (enforced at route level)
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { workerStats } from "../../workers/health.worker"; // optional integration
import { performance } from "perf_hooks";

/**
 * Get platform-wide stats
 * ------------------------------------------------------------
 * Returns aggregated data counts (athletes, coaches, sessions)
 */
export const getPlatformStats = async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const [athletes, coaches, institutions, sessions, competitions] = await Promise.all([
      prisma.athlete.count(),
      prisma.user.count({ where: { role: "COACH" } }),
      prisma.institution.count(),
      prisma.session.count(),
      prisma.competition.count(),
    ]);

    const duration = (performance.now() - start).toFixed(2);

    return res.status(200).json({
      success: true,
      message: "Platform analytics fetched successfully.",
      durationMs: duration,
      data: { athletes, coaches, institutions, sessions, competitions },
    });
  } catch (err) {
    logger.error("❌ Failed to fetch platform stats:", err);
    throw Errors.Server("Failed to fetch analytics data.");
  }
};

/**
 * Get user growth trends
 * ------------------------------------------------------------
 * Returns growth of athletes and institutions over time.
 */
export const getUserGrowthTrends = async (req: Request, res: Response) => {
  try {
    const athletes = await prisma.athlete.groupBy({
      by: ["createdAt"],
      _count: { id: true },
      orderBy: { createdAt: "asc" },
    });

    const institutions = await prisma.institution.groupBy({
      by: ["createdAt"],
      _count: { id: true },
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json({
      success: true,
      message: "User growth trends fetched.",
      data: { athletes, institutions },
    });
  } catch (err) {
    logger.error("❌ Failed to fetch growth trends:", err);
    throw Errors.Server("Failed to compute growth trends.");
  }
};

/**
 * Get engagement metrics
 * ------------------------------------------------------------
 * Measures sessions, message interactions, and competitions.
 */
export const getEngagementMetrics = async (req: Request, res: Response) => {
  try {
    const [sessions, messages, competitions] = await Promise.all([
      prisma.session.count(),
      prisma.message.count(),
      prisma.competition.count(),
    ]);

    const avgSessionSize = await prisma.session.aggregate({
      _avg: { duration: true },
    });

    return res.status(200).json({
      success: true,
      message: "Engagement metrics fetched successfully.",
      data: {
        totalSessions: sessions,
        totalMessages: messages,
        totalCompetitions: competitions,
        avgSessionDuration: avgSessionSize._avg.duration ?? 0,
      },
    });
  } catch (err) {
    logger.error("❌ Engagement metrics error:", err);
    throw Errors.Server("Failed to fetch engagement metrics.");
  }
};

/**
 * Get AI insights (future use)
 * ------------------------------------------------------------
 * Placeholder for future AI analytics integration.
 */
export const getAiInsights = async (req: Request, res: Response) => {
  try {
    // TODO: integrate with AI analytics microservice
    return res.status(200).json({
      success: true,
      message: "AI insights module placeholder — ready for integration.",
    });
  } catch (err) {
    throw Errors.Server("AI insights currently unavailable.");
  }
};