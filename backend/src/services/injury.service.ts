import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import logger from "../logger";

/**
 * Injury Service
 * ------------------------
 * Tracks, updates, and monitors athlete injury records.
 * Built for long-term medical tracking, prevention analytics,
 * and rehabilitation workflows.
 *
 * Features:
 *  - Add or update injury incidents with treatment logs.
 *  - Supports attachment linking (medical reports, scans).
 *  - Designed to work with future AI risk-prediction models.
 */

export class InjuryService {
  /**
   * Report a new injury for an athlete.
   * Prevents duplicates on same date and body part.
   */
  static async reportInjury({
    athleteId,
    description,
    bodyPart,
    severity,
    occurredAt,
    reportedById,
    attachments,
  }: {
    athleteId: string;
    description: string;
    bodyPart?: string;
    severity: "MINOR" | "MODERATE" | "SEVERE";
    occurredAt?: string | Date;
    reportedById: string;
    attachments?: string[];
  }) {
    try {
      const existing = await prisma.injury.findFirst({
        where: {
          athleteId,
          bodyPart,
          occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        },
      });

      if (existing) {
        throw Errors.Duplicate("Injury already reported for this date and body part");
      }

      const injury = await prisma.injury.create({
        data: {
          athleteId,
          description,
          bodyPart,
          severity,
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
          reportedById,
          attachments: attachments ?? [],
        },
      });

      logger.info(`🩹 Injury reported for athlete ${athleteId}`);
      return injury;
    } catch (err: any) {
      logger.error("❌ reportInjury failed: " + err.message);
      throw Errors.Server("Failed to report injury");
    }
  }

  /**
   * Update injury details (status, treatment, recovery date, etc.)
   */
  static async updateInjury({
    injuryId,
    status,
    treatmentNotes,
    recoveryDate,
    attachments,
  }: {
    injuryId: string;
    status?: "ONGOING" | "RECOVERING" | "RECOVERED";
    treatmentNotes?: string;
    recoveryDate?: string | Date;
    attachments?: string[];
  }) {
    try {
      const injury = await prisma.injury.update({
        where: { id: injuryId },
        data: {
          status,
          treatmentNotes,
          recoveryDate: recoveryDate ? new Date(recoveryDate) : undefined,
          attachments,
        },
      });

      logger.info(`✏️ Injury updated: ${injuryId}`);
      return injury;
    } catch (err: any) {
      logger.error("❌ updateInjury failed: " + err.message);
      throw Errors.Server("Failed to update injury");
    }
  }

  /**
   * Get all injuries for a specific athlete
   */
  static async getAthleteInjuries(athleteId: string) {
    try {
      const injuries = await prisma.injury.findMany({
        where: { athleteId },
        orderBy: { occurredAt: "desc" },
      });

      const stats = {
        total: injuries.length,
        active: injuries.filter((i) => i.status !== "RECOVERED").length,
        recovered: injuries.filter((i) => i.status === "RECOVERED").length,
      };

      return { injuries, stats };
    } catch (err: any) {
      logger.error("❌ getAthleteInjuries failed: " + err.message);
      throw Errors.Server("Failed to fetch athlete injuries");
    }
  }

  /**
   * Get injury analytics for a coach or institution
   */
  static async getInstitutionInjuryReport(institutionId: string) {
    try {
      const injuries = await prisma.injury.findMany({
        where: { athlete: { institutionId } },
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
        },
      });

      // Compute basic analytics (e.g. injury severity distribution)
      const severityCount = injuries.reduce(
        (acc, injury) => {
          acc[injury.severity] = (acc[injury.severity] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      return { injuries, analytics: { severityCount } };
    } catch (err: any) {
      logger.error("❌ getInstitutionInjuryReport failed: " + err.message);
      throw Errors.Server("Failed to fetch institution injury report");
    }
  }

  /**
   * Delete an injury record (admin-only)
   */
  static async deleteInjury(injuryId: string) {
    try {
      await prisma.injury.delete({ where: { id: injuryId } });
      logger.warn(`🗑️ Injury record deleted: ${injuryId}`);
      return { success: true };
    } catch (err: any) {
      logger.error("❌ deleteInjury failed: " + err.message);
      throw Errors.Server("Failed to delete injury record");
    }
  }
}

export default InjuryService;