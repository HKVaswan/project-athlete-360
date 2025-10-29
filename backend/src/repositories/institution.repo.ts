/**
 * institution.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for Institutions.
 * Handles all CRUD operations, coach assignments, and plan limitations.
 *
 * ⚙️ Enterprise-grade features:
 *  - Typed Prisma queries
 *  - Safe relation management
 *  - Strict business logic constraints (plan limits, ownership)
 *  - Scalable to support subscription tiers and analytics later
 */

import { Prisma, Institution } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class InstitutionRepository {
  /**
   * Create new institution
   * (usually called when a new admin registers & pays)
   */
  async createInstitution(data: Prisma.InstitutionCreateInput): Promise<Institution> {
    try {
      return await prisma.institution.create({ data });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw Errors.Duplicate("Institution with this name or code already exists.");
      }
      throw Errors.Server("Failed to create institution.");
    }
  }

  /**
   * Find institution by ID
   */
  async findById(id: string): Promise<Institution | null> {
    return prisma.institution.findUnique({
      where: { id },
      include: {
        admin: { select: { id: true, username: true, email: true } },
        coaches: { select: { id: true, name: true, email: true } },
        athletes: { select: { id: true, name: true, sport: true } },
      },
    });
  }

  /**
   * Find institution by code (used in registration)
   */
  async findByCode(code: string): Promise<Institution | null> {
    return prisma.institution.findUnique({
      where: { code },
      include: {
        admin: true,
        coaches: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * List all institutions with pagination
   */
  async listAll(
    page = 1,
    limit = 20
  ): Promise<{ data: Institution[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.institution.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          code: true,
          createdAt: true,
          admin: { select: { username: true, email: true } },
          _count: { select: { coaches: true, athletes: true } },
        },
      }),
      prisma.institution.count(),
    ]);

    return { data, total };
  }

  /**
   * Update institution details
   */
  async updateInstitution(
    id: string,
    data: Prisma.InstitutionUpdateInput
  ): Promise<Institution> {
    try {
      return await prisma.institution.update({ where: { id }, data });
    } catch (err: any) {
      if (err.code === "P2025") throw Errors.NotFound("Institution not found.");
      throw Errors.Server("Failed to update institution details.");
    }
  }

  /**
   * Assign coach to institution
   * (used when a coach registers or admin invites one)
   */
  async assignCoach(institutionId: string, coachId: string) {
    try {
      return await prisma.institution.update({
        where: { id: institutionId },
        data: { coaches: { connect: { id: coachId } } },
      });
    } catch (err) {
      throw Errors.Server("Failed to assign coach to institution.");
    }
  }

  /**
   * Remove coach from institution (admin action)
   */
  async removeCoach(institutionId: string, coachId: string) {
    try {
      return await prisma.institution.update({
        where: { id: institutionId },
        data: { coaches: { disconnect: { id: coachId } } },
      });
    } catch (err) {
      throw Errors.Server("Failed to remove coach from institution.");
    }
  }

  /**
   * Check if institution is within allowed limits (based on subscription plan)
   */
  async checkPlanLimits(institutionId: string): Promise<boolean> {
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      include: { _count: { select: { coaches: true, athletes: true } }, plan: true },
    });

    if (!institution) throw Errors.NotFound("Institution not found.");

    const plan = institution.plan;
    const coachLimit = plan?.maxCoaches ?? 10;
    const athleteLimit = plan?.maxAthletes ?? 200;

    return (
      institution._count.coaches <= coachLimit &&
      institution._count.athletes <= athleteLimit
    );
  }

  /**
   * Delete institution (admin only)
   * Supports soft deletion to preserve data integrity.
   */
  async deleteInstitution(id: string, softDelete = true): Promise<Institution> {
    if (softDelete) {
      return prisma.institution.update({
        where: { id },
        data: { active: false },
      });
    }
    return prisma.institution.delete({ where: { id } });
  }

  /**
   * Get dashboard overview metrics
   */
  async getOverview(id: string) {
    const [institution, counts] = await Promise.all([
      prisma.institution.findUnique({
        where: { id },
        select: {
          name: true,
          code: true,
          createdAt: true,
        },
      }),
      prisma.institution.findUnique({
        where: { id },
        select: {
          _count: {
            select: { coaches: true, athletes: true, competitions: true },
          },
        },
      }),
    ]);

    if (!institution) throw Errors.NotFound("Institution not found.");

    return {
      ...institution,
      metrics: counts?._count ?? {},
    };
  }
}

export const institutionRepository = new InstitutionRepository();