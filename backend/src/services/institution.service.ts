// src/services/institution.service.ts
/**
 * Institution Service
 * ------------------------------------------------------------
 * Handles:
 *  - Institution registration & plan setup
 *  - Admin linking & verification
 *  - Coach & athlete management within institution
 *  - Secure approval workflows
 *  - Institution profile updates
 *  - Data isolation for each institution (multi-tenant ready)
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate } from "../utils/pagination";
import { computeNextCursor } from "../utils/pagination";

/**
 * Create a new institution with an admin user
 * (Admin must be verified/paid through separate flow before activation)
 */
export const createInstitution = async (data: {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  contactEmail: string;
  phone?: string;
  adminUserId: string;
  planId?: string;
}) => {
  const adminUser = await prisma.user.findUnique({ where: { id: data.adminUserId } });
  if (!adminUser) throw Errors.NotFound("Admin user not found");

  const existing = await prisma.institution.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" } },
  });
  if (existing) throw Errors.Duplicate("Institution with this name already exists");

  const institution = await prisma.institution.create({
    data: {
      name: data.name.trim(),
      address: data.address,
      city: data.city,
      state: data.state,
      country: data.country,
      contactEmail: data.contactEmail.toLowerCase(),
      phone: data.phone,
      adminId: data.adminUserId,
      planId: data.planId || null,
      isActive: false, // becomes active only after verification/payment
      createdAt: new Date(),
    },
    include: { admin: true },
  });

  logger.info(`Institution created: ${institution.name} (Admin: ${data.adminUserId})`);
  return sanitizeInstitution(institution);
};

/**
 * Activate an institution (after admin verification or payment)
 */
export const activateInstitution = async (institutionId: string, activatedBy: string) => {
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");
  if (institution.isActive) throw Errors.BadRequest("Institution already active");

  const updated = await prisma.institution.update({
    where: { id: institutionId },
    data: { isActive: true, activatedAt: new Date() },
  });

  logger.info(`Institution ${institutionId} activated by ${activatedBy}`);
  return sanitizeInstitution(updated);
};

/**
 * Fetch institution details with admin, coaches, and athletes
 */
export const getInstitutionById = async (institutionId: string) => {
  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      coaches: { select: { id: true, name: true, username: true } },
      athletes: { select: { id: true, sport: true, user: { select: { name: true } } } },
    },
  });
  if (!institution) throw Errors.NotFound("Institution not found");
  return sanitizeInstitution(institution);
};

/**
 * List institutions (admin dashboard view)
 */
export const listInstitutions = async (query: any) => {
  const where: any = {};
  if (query.search) {
    const s = String(query.search).trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { city: { contains: s, mode: "insensitive" } },
      { country: { contains: s, mode: "insensitive" } },
    ];
  }

  const { prismaArgs, meta } = await paginate(query, "offset", {
    countFn: (where) => prisma.institution.count({ where }),
    where,
    includeTotal: true,
  });

  const institutions = await prisma.institution.findMany({
    ...prismaArgs,
    where,
    include: {
      admin: { select: { id: true, name: true, email: true } },
    },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(institutions);

  return { data: institutions.map(sanitizeInstitution), meta };
};

/**
 * Update institution details (admin-level)
 */
export const updateInstitution = async (
  institutionId: string,
  updates: Partial<{
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    contactEmail: string;
    phone: string;
    planId: string;
  }>,
  actorId: string
) => {
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  const updated = await prisma.institution.update({
    where: { id: institutionId },
    data: updates,
  });

  logger.info(`Institution ${institutionId} updated by ${actorId}`);
  return sanitizeInstitution(updated);
};

/**
 * Deactivate institution (soft deactivation)
 * Used when billing fails or admin cancels subscription
 */
export const deactivateInstitution = async (institutionId: string, reason?: string) => {
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  await prisma.institution.update({
    where: { id: institutionId },
    data: { isActive: false, deactivatedAt: new Date(), deactivationReason: reason || null },
  });

  logger.warn(`Institution ${institutionId} deactivated. Reason: ${reason || "N/A"}`);
  return { success: true };
};

/**
 * Get all coaches linked to an institution
 */
export const getInstitutionCoaches = async (institutionId: string) => {
  const coaches = await prisma.user.findMany({
    where: { institutionId, role: "coach" },
    select: { id: true, name: true, username: true, email: true },
  });
  return coaches;
};

/**
 * Get all athletes linked to an institution
 */
export const getInstitutionAthletes = async (institutionId: string) => {
  const athletes = await prisma.athlete.findMany({
    where: { institutionId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      coach: { select: { id: true, name: true } },
    },
  });
  return athletes.map((a) => ({
    id: a.id,
    name: a.user.name,
    sport: a.sport,
    coachName: a.coach?.name || null,
  }));
};

/**
 * Remove institution completely (hard delete - admin restricted)
 * Only used in extreme cases by system administrators.
 */
export const deleteInstitution = async (institutionId: string) => {
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  await prisma.institution.delete({ where: { id: institutionId } });
  logger.warn(`Institution permanently deleted: ${institution.name}`);
  return { success: true };
};

/**
 * Sanitizer
 */
const sanitizeInstitution = (institution: any) => {
  if (!institution) return null;
  const sanitized = { ...institution };
  if (institution.admin) {
    const { passwordHash, ...safeAdmin } = institution.admin;
    sanitized.admin = safeAdmin;
  }
  return sanitized;
};