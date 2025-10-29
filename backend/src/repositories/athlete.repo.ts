/**
 * athlete.repo.ts
 * ---------------------------------------------------------------------
 * Central data access layer for athlete-related operations.
 * Handles joins, performance summaries, approvals, and coach/institution linkage.
 *
 * ⚙️ Enterprise-grade features:
 *  - Strong TypeScript typing
 *  - Centralized error control via ApiError
 *  - Optimized Prisma queries
 *  - Transaction-safe operations
 */

import { Prisma, Athlete } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class AthleteRepository {
  /**
   * Create athlete record (linked with user & institution)
   */
  async createAthlete(data: Prisma.AthleteCreateInput): Promise<Athlete> {
    try {
      return await prisma.athlete.create({ data });
    } catch (err: any) {
      if (err.code === "P2003") {
        throw Errors.BadRequest("Invalid relation while creating athlete");
      }
      throw Errors.Server("Failed to create athlete");
    }
  }

  /**
   * Find athlete by ID
   */
  async findById(id: string): Promise<Athlete | null> {
    return prisma.athlete.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true, role: true } },
        institution: { select: { id: true, name: true, code: true } },
        coach: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * List all athletes for an institution
   */
  async findByInstitution(institutionId: string): Promise<Athlete[]> {
    return prisma.athlete.findMany({
      where: { institutionId },
      include: {
        user: { select: { id: true, username: true, email: true } },
        coach: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Find all athletes under a specific coach
   */
  async findByCoach(coachId: string): Promise<Athlete[]> {
    return prisma.athlete.findMany({
      where: { coachId },
      include: {
        user: { select: { id: true, username: true, email: true } },
        institution: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Update athlete details (performance stats, bio, etc.)
   */
  async updateAthlete(id: string, data: Prisma.AthleteUpdateInput): Promise<Athlete> {
    try {
      return await prisma.athlete.update({ where: { id }, data });
    } catch (err: any) {
      if (err.code === "P2025") throw Errors.NotFound("Athlete not found");
      throw Errors.Server("Error updating athlete");
    }
  }

  /**
   * Approve or reject athlete registration
   */
  async updateApprovalStatus(
    athleteId: string,
    approved: boolean,
    approverId?: string
  ): Promise<Athlete> {
    try {
      return await prisma.athlete.update({
        where: { id: athleteId },
        data: {
          approved,
          approvedBy: approved ? approverId : null,
        },
      });
    } catch {
      throw Errors.Server("Failed to update athlete approval status");
    }
  }

  /**
   * Assign coach to an athlete
   */
  async assignCoach(athleteId: string, coachId: string): Promise<Athlete> {
    try {
      return await prisma.athlete.update({
        where: { id: athleteId },
        data: { coach: { connect: { id: coachId } } },
      });
    } catch {
      throw Errors.Server("Failed to assign coach to athlete");
    }
  }

  /**
   * Get total number of athletes under an institution
   */
  async countByInstitution(institutionId: string): Promise<number> {
    return prisma.athlete.count({ where: { institutionId } });
  }

  /**
   * Search athletes (name or sport)
   */
  async searchAthletes(query: string, institutionId?: string): Promise<Athlete[]> {
    return prisma.athlete.findMany({
      where: {
        AND: [
          institutionId ? { institutionId } : {},
          {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { sport: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
      },
      include: {
        user: { select: { username: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  /**
   * Delete athlete (soft delete to preserve record integrity)
   */
  async deleteAthlete(id: string, softDelete = true): Promise<Athlete> {
    if (softDelete) {
      return prisma.athlete.update({
        where: { id },
        data: { active: false },
      });
    }
    return prisma.athlete.delete({ where: { id } });
  }
}

export const athleteRepository = new AthleteRepository();