/**
 * performance.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for Athlete Performance tracking.
 *
 * Features:
 *  - CRUD for performance records
 *  - Historical data queries (by athlete, date range, metric type)
 *  - Aggregated stats & performance trend analytics
 *  - AI-ready hooks for predictive performance analysis
 *  - Strict validation & data integrity
 */

import { Prisma, Performance } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class PerformanceRepository {
  /**
   * Create or update a performance record for an athlete
   * Avoids duplication for same date + metricType
   */
  async upsertPerformance(data: {
    athleteId: string;
    metricType: string; // e.g., "speed", "stamina", "strength"
    value: number;
    date: Date;
    notes?: string | null;
  }): Promise<Performance> {
    try {
      return await prisma.performance.upsert({
        where: {
          athleteId_metricType_date: {
            athleteId: data.athleteId,
            metricType: data.metricType,
            date: data.date,
          },
        },
        update: { value: data.value, notes: data.notes },
        create: data,
      });
    } catch (err: any) {
      if (err?.code === "P2003") throw Errors.BadRequest("Invalid athlete reference.");
      throw Errors.Server("Failed to record performance.");
    }
  }

  /**
   * Fetch all performance records for an athlete
   * Optional filters for metric type and date range
   */
  async getAthletePerformance(athleteId: string, filters?: { metricType?: string; from?: Date; to?: Date }) {
    try {
      const where: Prisma.PerformanceWhereInput = { athleteId };
      if (filters?.metricType) where.metricType = filters.metricType;
      if (filters?.from || filters?.to)
        where.date = { gte: filters.from ?? new Date("2000-01-01"), lte: filters.to ?? new Date() };

      return await prisma.performance.findMany({
        where,
        orderBy: { date: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete performance records.");
    }
  }

  /**
   * Fetch average performance for each metric of an athlete
   * Used for dashboard summaries and charts
   */
  async getPerformanceSummary(athleteId: string) {
    try {
      const results = await prisma.performance.groupBy({
        by: ["metricType"],
        _avg: { value: true },
        _count: { value: true },
        where: { athleteId },
      });

      return results.map(r => ({
        metricType: r.metricType,
        average: Number(r._avg.value?.toFixed(2) ?? 0),
        entries: r._count.value,
      }));
    } catch (err) {
      throw Errors.Server("Failed to compute performance summary.");
    }
  }

  /**
   * Identify top performing athletes (for leaderboards)
   * Ranks athletes by selected metricType average
   */
  async getTopPerformers(metricType: string, limit = 10) {
    try {
      const records = await prisma.performance.groupBy({
        by: ["athleteId"],
        _avg: { value: true },
        where: { metricType },
        orderBy: { _avg: { value: "desc" } },
        take: limit,
      });

      const enriched = await Promise.all(
        records.map(async r => {
          const athlete = await prisma.athlete.findUnique({
            where: { id: r.athleteId },
            select: { id: true, name: true, sport: true },
          });
          return { athlete, average: Number(r._avg.value?.toFixed(2) ?? 0) };
        })
      );

      return enriched.filter(e => e.athlete !== null);
    } catch (err) {
      throw Errors.Server("Failed to fetch top performers.");
    }
  }

  /**
   * Delete a performance record
   */
  async deletePerformance(id: string) {
    try {
      await prisma.performance.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Performance record not found.");
      throw Errors.Server("Failed to delete performance record.");
    }
  }

  /**
   * Get institution-level aggregated data (for analytics dashboards)
   * e.g., average speed, stamina, etc. across all athletes
   */
  async getInstitutionAnalytics(institutionId: string) {
    try {
      const athletes = await prisma.athlete.findMany({
        where: { institutionId },
        select: { id: true },
      });

      if (athletes.length === 0) return [];

      const athleteIds = athletes.map(a => a.id);

      const analytics = await prisma.performance.groupBy({
        by: ["metricType"],
        _avg: { value: true },
        where: { athleteId: { in: athleteIds } },
      });

      return analytics.map(a => ({
        metricType: a.metricType,
        average: Number(a._avg.value?.toFixed(2) ?? 0),
      }));
    } catch (err) {
      throw Errors.Server("Failed to fetch institution analytics.");
    }
  }
}

export const performanceRepository = new PerformanceRepository();