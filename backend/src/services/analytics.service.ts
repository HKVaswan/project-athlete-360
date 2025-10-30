/**
 * src/services/analytics.service.ts
 * ------------------------------------------------------------------------
 * Enterprise Analytics Service
 *
 * Provides system-wide analytics for admins and coaches:
 *  - User growth, athlete activity, session engagement
 *  - Competition trends and performance averages
 *  - Ready for AI-based predictive analytics
 */

import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { logger } from "../logger";

export class AnalyticsService {
  /**
   * 📊 Overview metrics for dashboard
   * Includes total counts and basic engagement indicators
   */
  async getOverview() {
    try {
      const [athletes, coaches, institutions, competitions, sessions] = await Promise.all([
        prisma.athlete.count(),
        prisma.user.count({ where: { role: "coach" } }),
        prisma.institution.count(),
        prisma.competition.count(),
        prisma.session.count(),
      ]);

      return {
        totalAthletes: athletes,
        totalCoaches: coaches,
        totalInstitutions: institutions,
        totalCompetitions: competitions,
        totalSessions: sessions,
      };
    } catch (err) {
      logger.error("❌ AnalyticsService.getOverview failed:", err);
      throw Errors.Server("Failed to fetch analytics overview.");
    }
  }

  /**
   * 📈 Trend analysis (activity over time)
   * Example: athlete signups, sessions, competitions by month
   */
  async getTrends() {
    try {
      const trends = await prisma.$queryRawUnsafe<{
        month: string;
        athletes: number;
        sessions: number;
        competitions: number;
      }[]>(`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') AS month,
          COUNT(DISTINCT CASE WHEN role = 'athlete' THEN id END) AS athletes,
          COUNT(DISTINCT CASE WHEN type = 'session' THEN id END) AS sessions,
          COUNT(DISTINCT CASE WHEN type = 'competition' THEN id END) AS competitions
        FROM combined_activity_view
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12;
      `);

      return trends;
    } catch (err) {
      logger.error("❌ AnalyticsService.getTrends failed:", err);
      throw Errors.Server("Failed to fetch trend data.");
    }
  }

  /**
   * 🧠 Performance analytics
   * Aggregates athlete performance results for coaches/admins
   */
  async getPerformanceAnalytics() {
    try {
      const results = await prisma.athleteCompetition.groupBy({
        by: ["athleteId"],
        _avg: { position: true },
        _count: { competitionId: true },
        orderBy: { _avg: { position: "asc" } },
        take: 20,
      });

      const athletes = await prisma.athlete.findMany({
        where: { id: { in: results.map((r) => r.athleteId) } },
        select: { id: true, name: true, sport: true, institutionId: true },
      });

      return results.map((r) => ({
        athlete: athletes.find((a) => a.id === r.athleteId),
        averagePosition: r._avg.position,
        competitionsCount: r._count.competitionId,
      }));
    } catch (err) {
      logger.error("❌ AnalyticsService.getPerformanceAnalytics failed:", err);
      throw Errors.Server("Failed to fetch performance analytics.");
    }
  }
}

export const analyticsService = new AnalyticsService();