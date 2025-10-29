/**
 * athlete.repo.ts
 * ------------------------------------------------------------------
 * Data access layer for Athlete-related operations.
 * - Handles safe creation, updates, approvals, and associations.
 * - Optimized for performance, security, and clarity.
 * - Supports pagination, search, and transaction-safe operations.
 */

import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { buildOffsetPagination } from "../utils/pagination";
import { Prisma, Athlete } from "@prisma/client";

export class AthleteRepository {
  /**
   * Create a new athlete (pending approval if required)
   */
  async createAthlete(data: Prisma.AthleteCreateInput): Promise<Athlete> {
    try {
      // Prevent duplicate athlete for same user
      const existing = await prisma.athlete.findUnique({
        where: { userId: data.user.connect?.id },
      });
      if (existing) throw Errors.Duplicate("Athlete profile already exists.");

      const athlete = await prisma.athlete.create({ data });
      return athlete;
    } catch (err: any) {
      if (err?.code === "P2002") throw Errors.Duplicate("Duplicate athlete entry.");
      throw Errors.Server("Failed to create athlete.");
    }
  }

  /**
   * Fetch athlete by ID (with optional deep include)
   */
  async findById(id: string, includeRelations = false) {
    try {
      const athlete = await prisma.athlete.findUnique({
        where: { id },
        include: includeRelations
          ? {
              user: { select: { id: true, name: true, email: true, username: true } },
              institution: { select: { id: true, name: true, code: true } },
              performances: true,
              sessions: true,
              attendance: true,
              competitions: {
                include: { competition: { select: { name: true, startDate: true, location: true } } },
              },
            }
          : undefined,
      });

      if (!athlete) throw Errors.NotFound("Athlete not found.");
      return athlete;
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete details.");
    }
  }

  /**
   * Fetch athletes list with pagination and filtering
   */
  async listAthletes(options: {
    page?: number;
    limit?: number;
    approved?: boolean;
    institutionId?: string;
    search?: string;
  }) {
    try {
      const { page = 1, limit = 20, approved, institutionId, search } = options;

      const where: any = {};
      if (approved !== undefined) where.approved = approved;
      if (institutionId) where.institutionId = institutionId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { athleteCode: { contains: search, mode: "insensitive" } },
        ];
      }

      const { prismaArgs, meta } = buildOffsetPagination({ page, limit } as any);
      prismaArgs.where = where;
      prismaArgs.include = {
        user: { select: { username: true, email: true } },
        institution: { select: { name: true, code: true } },
      };

      const [rows, total] = await Promise.all([
        prisma.athlete.findMany(prismaArgs as any),
        prisma.athlete.count({ where }),
      ]);

      return {
        data: rows,
        meta: { ...meta, total, totalPages: Math.ceil(total / meta.limit) },
      };
    } catch (err) {
      throw Errors.Server("Failed to list athletes.");
    }
  }

  /**
   * Approve athlete (admin/coach)
   */
  async approveAthlete(athleteId: string, approverId: string) {
    try {
      const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
      if (!athlete) throw Errors.NotFound("Athlete not found.");
      if (athlete.approved) throw Errors.BadRequest("Athlete already approved.");

      return await prisma.athlete.update({
        where: { id: athleteId },
        data: { approved: true, approvedBy: approverId },
      });
    } catch (err) {
      throw Errors.Server("Failed to approve athlete.");
    }
  }

  /**
   * Update athlete details
   */
  async updateAthlete(id: string, data: Partial<Prisma.AthleteUpdateInput>) {
    try {
      const athlete = await prisma.athlete.update({
        where: { id },
        data,
      });
      return athlete;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Athlete not found.");
      throw Errors.Server("Failed to update athlete.");
    }
  }

  /**
   * Assign athlete to a coach
   * - Ensures both belong to same institution (data integrity)
   */
  async assignCoach(athleteId: string, coachId: string) {
    try {
      const [athlete, coach] = await Promise.all([
        prisma.athlete.findUnique({ where: { id: athleteId } }),
        prisma.user.findUnique({ where: { id: coachId, role: "coach" } }),
      ]);

      if (!athlete) throw Errors.NotFound("Athlete not found.");
      if (!coach) throw Errors.NotFound("Coach not found.");

      if (athlete.institutionId && coach.institutionId && athlete.institutionId !== coach.institutionId) {
        throw Errors.BadRequest("Coach and athlete belong to different institutions.");
      }

      return await prisma.athlete.update({
        where: { id: athleteId },
        data: { coachId },
      });
    } catch (err) {
      throw Errors.Server("Failed to assign coach to athlete.");
    }
  }

  /**
   * Delete athlete (admin/institution only)
   * - Removes linked data via transaction for data safety.
   */
  async deleteAthlete(id: string) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.performance.deleteMany({ where: { athleteId: id } });
        await tx.session.deleteMany({ where: { athleteId: id } });
        await tx.attendance.deleteMany({ where: { athleteId: id } });
        await tx.athleteCompetition.deleteMany({ where: { athleteId: id } });
        await tx.athlete.delete({ where: { id } });
      });

      return true;
    } catch (err) {
      throw Errors.Server("Failed to delete athlete.");
    }
  }
}

export const athleteRepository = new AthleteRepository();