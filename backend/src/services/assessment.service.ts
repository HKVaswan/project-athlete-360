import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import logger from "../logger";

/**
 * Service: Assessment
 * -----------------------------------------
 * Handles coach/admin evaluations of athletes.
 * Includes:
 *  - Creating/updating periodic assessments
 *  - Fetching all assessments for a coach or athlete
 *  - Average performance analytics
 *  - Secure access (role-based checks done at controller level)
 */

export class AssessmentService {
  /**
   * Create or update an athlete's assessment (by coach/admin)
   */
  static async upsertAssessment(data: {
    athleteId: string;
    coachId: string;
    sessionId?: string;
    score: number;
    category: string; // e.g., "Strength", "Endurance"
    remarks?: string;
    date?: Date;
  }) {
    const { athleteId, coachId, sessionId, score, category, remarks, date } = data;

    if (!athleteId || !coachId || !category || score == null) {
      throw Errors.Validation("Missing required assessment fields");
    }

    try {
      const assessment = await prisma.assessment.upsert({
        where: {
          athleteId_coachId_category: {
            athleteId,
            coachId,
            category,
          },
        },
        update: {
          score,
          remarks,
          sessionId,
          date: date || new Date(),
        },
        create: {
          athleteId,
          coachId,
          sessionId,
          score,
          category,
          remarks,
          date: date || new Date(),
        },
      });

      logger.info(
        `📊 Assessment upserted: [Athlete: ${athleteId}] [Coach: ${coachId}] [Category: ${category}]`
      );
      return assessment;
    } catch (err) {
      logger.error("❌ AssessmentService.upsertAssessment failed: " + err);
      throw Errors.Server("Failed to upsert assessment");
    }
  }

  /**
   * Get all assessments for a particular athlete
   */
  static async getAssessmentsByAthlete(athleteId: string) {
    if (!athleteId) throw Errors.Validation("athleteId required");

    try {
      const assessments = await prisma.assessment.findMany({
        where: { athleteId },
        include: {
          coach: { select: { id: true, name: true } },
          session: { select: { id: true, title: true, date: true } },
        },
        orderBy: { date: "desc" },
      });

      return assessments;
    } catch (err) {
      logger.error("❌ getAssessmentsByAthlete failed: " + err);
      throw Errors.Server("Failed to fetch assessments");
    }
  }

  /**
   * Get all assessments done by a particular coach
   */
  static async getAssessmentsByCoach(coachId: string) {
    if (!coachId) throw Errors.Validation("coachId required");

    try {
      const assessments = await prisma.assessment.findMany({
        where: { coachId },
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
          session: { select: { id: true, title: true, date: true } },
        },
        orderBy: { date: "desc" },
      });

      return assessments;
    } catch (err) {
      logger.error("❌ getAssessmentsByCoach failed: " + err);
      throw Errors.Server("Failed to fetch coach assessments");
    }
  }

  /**
   * Compute athlete’s average score across all categories
   */
  static async getAthleteAverages(athleteId: string) {
    if (!athleteId) throw Errors.Validation("athleteId required");

    try {
      const grouped = await prisma.assessment.groupBy({
        by: ["category"],
        where: { athleteId },
        _avg: { score: true },
        _count: { category: true },
      });

      return grouped.map((g) => ({
        category: g.category,
        avgScore: g._avg.score,
        totalAssessments: g._count.category,
      }));
    } catch (err) {
      logger.error("❌ getAthleteAverages failed: " + err);
      throw Errors.Server("Failed to compute athlete averages");
    }
  }

  /**
   * Delete assessment record (Admin only)
   */
  static async deleteAssessment(id: string) {
    try {
      await prisma.assessment.delete({ where: { id } });
      logger.info(`🗑️ Assessment deleted: ${id}`);
      return { success: true };
    } catch (err) {
      logger.error("❌ deleteAssessment failed: " + err);
      throw Errors.Server("Failed to delete assessment");
    }
  }
}

export default AssessmentService;