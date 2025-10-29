/**
 * injury.repo.ts
 * ---------------------------------------------------------------------
 * Data Access Layer for Athlete Injuries.
 *
 * Features:
 *  - Full CRUD with safety checks
 *  - Rich querying (by athlete, institution, status)
 *  - Automatic recovery tracking
 *  - Designed for AI/analytics use (injury trends, recovery predictions)
 */

import { Prisma, Injury } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class InjuryRepository {
  /**
   * Create a new injury record.
   * Validates athlete & institution reference.
   */
  async createInjury(data: Prisma.InjuryCreateInput): Promise<Injury> {
    try {
      return await prisma.injury.create({ data });
    } catch (err: any) {
      if (err?.code === "P2003") throw Errors.BadRequest("Invalid athlete or institution reference.");
      throw Errors.Server("Failed to create injury record.");
    }
  }

  /**
   * Fetch injury by ID.
   */
  async getInjuryById(id: string) {
    try {
      const injury = await prisma.injury.findUnique({
        where: { id },
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
          institution: { select: { id: true, name: true } },
        },
      });
      if (!injury) throw Errors.NotFound("Injury record not found.");
      return injury;
    } catch (err) {
      throw Errors.Server("Failed to fetch injury details.");
    }
  }

  /**
   * List injuries for an athlete.
   * Optional filters: status, date range.
   */
  async getAthleteInjuries(athleteId: string, options?: { status?: string; from?: Date; to?: Date }) {
    try {
      const where: Prisma.InjuryWhereInput = { athleteId };

      if (options?.status) where.status = options.status as any;
      if (options?.from || options?.to)
        where.reportedAt = { gte: options.from, lte: options.to ?? new Date() };

      return await prisma.injury.findMany({
        where,
        orderBy: { reportedAt: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete injuries.");
    }
  }

  /**
   * List injuries for an institution (admin view).
   */
  async getInstitutionInjuries(institutionId: string) {
    try {
      return await prisma.injury.findMany({
        where: { institutionId },
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
        },
        orderBy: { reportedAt: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch institution injuries.");
    }
  }

  /**
   * Update injury record (status, treatment, recovery notes)
   */
  async updateInjury(id: string, data: Prisma.InjuryUpdateInput) {
    try {
      const updated = await prisma.injury.update({
        where: { id },
        data,
      });
      return updated;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Injury record not found.");
      throw Errors.Server("Failed to update injury record.");
    }
  }

  /**
   * Mark recovery completion.
   */
  async markRecovered(id: string, recoveryDate = new Date()) {
    try {
      return await prisma.injury.update({
        where: { id },
        data: {
          status: "RECOVERED",
          recoveredAt: recoveryDate,
        },
      });
    } catch (err) {
      if (err?.code === "P2025") throw Errors.NotFound("Injury record not found.");
      throw Errors.Server("Failed to mark recovery.");
    }
  }

  /**
   * Delete injury record (admin only)
   */
  async deleteInjury(id: string) {
    try {
      await prisma.injury.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Injury record not found.");
      throw Errors.Server("Failed to delete injury record.");
    }
  }
}

export const injuryRepository = new InjuryRepository();