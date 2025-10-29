/**
 * competition.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for Competitions & AthleteParticipation.
 * Enterprise features:
 *  - Typed Prisma usage
 *  - Safe upserts and uniqueness checks
 *  - Pagination-friendly listing
 *  - Helpful methods for adding/removing participants and updating results
 *  - Uses Errors factory for consistent error responses
 */

import { Prisma, Competition, AthleteCompetition } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { paginate, buildOffsetPagination } from "../utils/pagination";

export class CompetitionRepository {
  /**
   * Create competition
   */
  async createCompetition(data: Prisma.CompetitionCreateInput): Promise<Competition> {
    try {
      return await prisma.competition.create({ data });
    } catch (err: any) {
      if (err.code === "P2002") throw Errors.Duplicate("Competition already exists.");
      throw Errors.Server("Failed to create competition.");
    }
  }

  /**
   * Find competition by id (with participants)
   */
  async findById(id: string) {
    try {
      const comp = await prisma.competition.findUnique({
        where: { id },
        include: {
          participants: {
            include: { athlete: { select: { id: true, name: true, athleteCode: true, sport: true } } },
          },
          institution: { select: { id: true, name: true, code: true } },
        },
      });
      return comp;
    } catch (err) {
      throw Errors.Server("Failed to fetch competition.");
    }
  }

  /**
   * List competitions with optional filters + pagination (offset)
   */
  async listCompetitions(options: {
    institutionId?: string | null;
    upcoming?: boolean;
    past?: boolean;
    page?: number;
    limit?: number;
  }) {
    try {
      const { institutionId, upcoming, past, page = 1, limit = 20 } = options;
      const where: any = {};
      const now = new Date();

      if (institutionId) where.institutionId = institutionId;
      if (upcoming) where.startDate = { gt: now };
      if (past) where.endDate = { lt: now };

      const { prismaArgs, meta } = buildOffsetPagination({ page, limit } as any);
      prismaArgs.where = where;
      prismaArgs.include = {
        institution: { select: { id: true, name: true } },
        _count: { select: { participants: true } },
      };

      const [rows, total] = await Promise.all([
        prisma.competition.findMany(prismaArgs as any),
        prisma.competition.count({ where }),
      ]);

      return {
        data: rows,
        meta: { ...meta, total, totalPages: Math.ceil(total / meta.limit) },
      };
    } catch (err) {
      throw Errors.Server("Failed to list competitions.");
    }
  }

  /**
   * Add athlete to competition (safe upsert)
   */
  async addParticipant(competitionId: string, athleteId: string): Promise<AthleteCompetition> {
    try {
      // Ensure athlete exists
      const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
      if (!athlete) throw Errors.NotFound("Athlete not found.");

      // Ensure competition exists
      const comp = await prisma.competition.findUnique({ where: { id: competitionId } });
      if (!comp) throw Errors.NotFound("Competition not found.");

      // Upsert participation
      return await prisma.athleteCompetition.upsert({
        where: { athleteId_competitionId: { athleteId, competitionId } },
        update: {},
        create: { athleteId, competitionId },
      });
    } catch (err: any) {
      if (err instanceof Errors.ApiError) throw err;
      throw Errors.Server("Failed to add participant to competition.");
    }
  }

  /**
   * Remove athlete from competition
   */
  async removeParticipant(competitionId: string, athleteId: string) {
    try {
      await prisma.athleteCompetition.delete({
        where: { athleteId_competitionId: { athleteId, competitionId } },
      });
      return true;
    } catch (err: any) {
      // If not found, treat as idempotent success
      if (err?.code === "P2025") return true;
      throw Errors.Server("Failed to remove participant.");
    }
  }

  /**
   * Update participant result (result, position, notes)
   */
  async updateParticipantResult(payload: {
    athleteId: string;
    competitionId: string;
    result?: string | null;
    position?: number | null;
    performanceNotes?: string | null;
  }) {
    const { athleteId, competitionId, result, position, performanceNotes } = payload;
    try {
      const updated = await prisma.athleteCompetition.update({
        where: { athleteId_competitionId: { athleteId, competitionId } },
        data: { result, position, performanceNotes },
      });
      return updated;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Participation not found.");
      throw Errors.Server("Failed to update participant result.");
    }
  }

  /**
   * Get competitions for a given athlete
   */
  async getCompetitionsByAthlete(athleteId: string) {
    try {
      const rows = await prisma.athleteCompetition.findMany({
        where: { athleteId },
        include: {
          competition: {
            select: { id: true, name: true, startDate: true, endDate: true, location: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return rows;
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete competitions.");
    }
  }

  /**
   * Update competition metadata
   */
  async updateCompetition(id: string, data: Prisma.CompetitionUpdateInput) {
    try {
      return await prisma.competition.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Competition not found.");
      throw Errors.Server("Failed to update competition.");
    }
  }

  /**
   * Delete competition (hard delete)
   */
  async deleteCompetition(id: string) {
    try {
      await prisma.competition.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Competition not found.");
      throw Errors.Server("Failed to delete competition.");
    }
  }
}

export const competitionRepository = new CompetitionRepository();