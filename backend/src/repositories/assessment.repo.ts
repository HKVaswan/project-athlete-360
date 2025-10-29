/**
 * assessment.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for athlete assessments and evaluations.
 *
 * Features:
 *  - CRUD operations for assessments
 *  - Secure coach-level creation and updates
 *  - Support for multiple assessment types (physical, skill, mental, etc.)
 *  - Scalable for multi-metric assessment forms
 *  - Aggregated summary and historical performance tracking
 */

import { Prisma, Assessment } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class AssessmentRepository {
  /**
   * Create a new athlete assessment.
   * Used by coaches or institutions to record evaluations.
   */
  async createAssessment(data: Prisma.AssessmentCreateInput): Promise<Assessment> {
    try {
      return await prisma.assessment.create({ data });
    } catch (err: any) {
      if (err?.code === "P2003") throw Errors.BadRequest("Invalid athlete or coach reference.");
      throw Errors.Server("Failed to create assessment.");
    }
  }

  /**
   * Update an assessment — typically by the coach who created it.
   */
  async updateAssessment(id: string, data: Prisma.AssessmentUpdateInput): Promise<Assessment> {
    try {
      return await prisma.assessment.update({
        where: { id },
        data,
      });
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Assessment not found.");
      throw Errors.Server("Failed to update assessment.");
    }
  }

  /**
   * Fetch all assessments for an athlete.
   * Includes coach info and summary fields.
   */
  async getAssessmentsByAthlete(athleteId: string) {
    try {
      return await prisma.assessment.findMany({
        where: { athleteId },
        include: {
          coach: { select: { id: true, name: true, username: true, email: true } },
        },
        orderBy: { date: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch assessments for athlete.");
    }
  }

  /**
   * Get detailed single assessment record.
   */
  async getAssessmentById(id: string) {
    try {
      const assessment = await prisma.assessment.findUnique({
        where: { id },
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
          coach: { select: { id: true, name: true } },
        },
      });
      if (!assessment) throw Errors.NotFound("Assessment not found.");
      return assessment;
    } catch (err) {
      throw Errors.Server("Failed to fetch assessment details.");
    }
  }

  /**
   * Delete an assessment record (admin-only or owner coach).
   */
  async deleteAssessment(id: string) {
    try {
      await prisma.assessment.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Assessment not found.");
      throw Errors.Server("Failed to delete assessment.");
    }
  }

  /**
   * Get aggregated summary for an athlete — average scores per category.
   * Used in analytics dashboards and performance reports.
   */
  async getAssessmentSummary(athleteId: string) {
    try {
      const results = await prisma.assessment.groupBy({
        by: ["category"], // e.g., "Endurance", "Agility", "Discipline"
        _avg: { score: true },
        where: { athleteId },
      });

      return results.map(r => ({
        category: r.category,
        averageScore: Number(r._avg.score?.toFixed(2) ?? 0),
      }));
    } catch (err) {
      throw Errors.Server("Failed to compute assessment summary.");
    }
  }

  /**
   * Institution-level analytics:
   * Returns average scores by category across all athletes.
   */
  async getInstitutionAssessmentAnalytics(institutionId: string) {
    try {
      const athletes = await prisma.athlete.findMany({
        where: { institutionId },
        select: { id: true },
      });

      if (athletes.length === 0) return [];

      const athleteIds = athletes.map(a => a.id);

      const analytics = await prisma.assessment.groupBy({
        by: ["category"],
        _avg: { score: true },
        where: { athleteId: { in: athleteIds } },
      });

      return analytics.map(a => ({
        category: a.category,
        averageScore: Number(a._avg.score?.toFixed(2) ?? 0),
      }));
    } catch (err) {
      throw Errors.Server("Failed to fetch institution assessment analytics.");
    }
  }
}

export const assessmentRepository = new AssessmentRepository();