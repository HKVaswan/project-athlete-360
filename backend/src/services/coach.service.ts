/**
 * src/services/coach.service.ts
 * --------------------------------------------------------------------------
 * Coach Service (Enterprise Edition)
 *
 * Responsibilities:
 *  - Coach creation, linking, and management
 *  - Enforces institution plan and athlete quota
 *  - Secure updates with audit logging
 *  - Assigns and tracks athletes under coaches
 *  - Integrated with subscription + quota + audit services
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import logger from "../logger";
import { quotaService } from "./quota.service";
import { recordAuditEvent } from "./audit.service";
import { checkActiveSubscription } from "./subscription.service";

/* ---------------------------------------------------------------------------
   🧩 Create Coach (Institution-bound, plan + subscription enforced)
--------------------------------------------------------------------------- */
export const createCoach = async (
  data: {
    userId: string;
    sport: string;
    qualification?: string;
    experienceYears?: number;
    bio?: string;
    institutionId?: string;
  },
  actor?: { id: string; role: string; ip?: string }
) => {
  const user = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!user) throw Errors.NotFound("User not found for coach creation");

  const existingCoach = await prisma.coach.findUnique({ where: { userId: data.userId } });
  if (existingCoach) throw Errors.Duplicate("Coach already exists for this user");

  if (data.institutionId) {
    const institution = await prisma.institution.findUnique({ where: { id: data.institutionId } });
    if (!institution) throw Errors.NotFound("Institution not found");

    // Ensure institution subscription is active
    await checkActiveSubscription(institution.id);

    // Enforce plan limit for coaches
    await quotaService.ensureWithinQuota(institution.id, "coaches");
  }

  const coach = await prisma.coach.create({
    data: { ...data, joinedAt: new Date() },
    include: { user: true, institution: true },
  });

  await recordAuditEvent({
    actorId: actor?.id || data.userId,
    actorRole: actor?.role || "system",
    ip: actor?.ip,
    action: "COACH_CREATE",
    details: { coachId: coach.id, institutionId: data.institutionId },
  });

  logger.info(`🎯 Coach created: ${coach.user?.name || coach.id}`);

  return sanitizeCoach(coach);
};

/* ---------------------------------------------------------------------------
   📋 Get Coach By ID (with linked athletes)
--------------------------------------------------------------------------- */
export const getCoachById = async (id: string, actor?: { id: string; role: string }) => {
  const coach = await prisma.coach.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, username: true, role: true } },
      institution: { select: { id: true, name: true } },
      athletes: {
        include: {
          user: { select: { id: true, name: true, username: true } },
        },
      },
    },
  });

  if (!coach) throw Errors.NotFound("Coach not found");

  await recordAuditEvent({
    actorId: actor?.id,
    actorRole: actor?.role,
    action: "COACH_VIEW",
    details: { coachId: id },
  });

  return sanitizeCoach(coach);
};

/* ---------------------------------------------------------------------------
   🧑‍🏫 Link Athlete to Coach (Quota enforced)
--------------------------------------------------------------------------- */
export const linkAthleteToCoach = async (
  coachId: string,
  athleteId: string,
  actor?: { id: string; role: string; ip?: string }
) => {
  const coach = await prisma.coach.findUnique({
    where: { id: coachId },
    include: { institution: true },
  });
  if (!coach) throw Errors.NotFound("Coach not found");

  const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
  if (!athlete) throw Errors.NotFound("Athlete not found");

  // Ensure athlete is from the same institution
  if (coach.institutionId && athlete.institutionId !== coach.institutionId)
    throw Errors.Forbidden("Coach and athlete must belong to the same institution.");

  // Enforce quota: ensure coach doesn't exceed athlete limit
  await quotaService.ensureCoachHasCapacity(coachId);

  // Update athlete record
  await prisma.athlete.update({
    where: { id: athleteId },
    data: { coachId },
  });

  await recordAuditEvent({
    actorId: actor?.id,
    actorRole: actor?.role,
    ip: actor?.ip,
    action: "ATHLETE_COACH_LINK",
    details: { coachId, athleteId },
  });

  logger.info(`Coach ${coachId} linked to athlete ${athleteId}`);
  return { success: true };
};

/* ---------------------------------------------------------------------------
   🔗 Unlink Athlete from Coach
--------------------------------------------------------------------------- */
export const unlinkAthleteFromCoach = async (
  coachId: string,
  athleteId: string,
  actor?: { id: string; role: string }
) => {
  const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
  if (!athlete) throw Errors.NotFound("Athlete not found");

  if (athlete.coachId !== coachId)
    throw Errors.BadRequest("This athlete is not linked with the given coach.");

  await prisma.athlete.update({
    where: { id: athleteId },
    data: { coachId: null },
  });

  await recordAuditEvent({
    actorId: actor?.id,
    actorRole: actor?.role,
    action: "ATHLETE_COACH_UNLINK",
    details: { coachId, athleteId },
  });

  logger.info(`Athlete ${athleteId} unlinked from coach ${coachId}`);
  return { success: true };
};

/* ---------------------------------------------------------------------------
   ✏️ Update Coach Profile
--------------------------------------------------------------------------- */
export const updateCoach = async (
  coachId: string,
  updates: {
    sport?: string;
    qualification?: string;
    experienceYears?: number;
    bio?: string;
  },
  actor?: { id: string; role: string; ip?: string }
) => {
  const existing = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!existing) throw Errors.NotFound("Coach not found");

  const updated = await prisma.coach.update({
    where: { id: coachId },
    data: { ...updates },
    include: { user: true, institution: true },
  });

  await recordAuditEvent({
    actorId: actor?.id,
    actorRole: actor?.role,
    ip: actor?.ip,
    action: "COACH_UPDATE",
    details: { coachId },
  });

  logger.info(`Coach ${coachId} updated by ${actor?.id || "system"}`);
  return sanitizeCoach(updated);
};

/* ---------------------------------------------------------------------------
   ❌ Soft Delete Coach (keeps audit integrity)
--------------------------------------------------------------------------- */
export const deleteCoach = async (coachId: string, actor?: { id: string; role: string }) => {
  const existing = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!existing) throw Errors.NotFound("Coach not found");

  await prisma.coach.update({
    where: { id: coachId },
    data: { deleted: true, deletedAt: new Date() },
  });

  await recordAuditEvent({
    actorId: actor?.id,
    actorRole: actor?.role,
    action: "COACH_DELETE",
    details: { coachId },
  });

  logger.warn(`Coach ${coachId} soft-deleted`);
  return { success: true };
};

/* ---------------------------------------------------------------------------
   🧹 Helper: Sanitize coach object
--------------------------------------------------------------------------- */
const sanitizeCoach = (coach: any) => {
  if (!coach) return null;
  const sanitized = { ...coach };
  if (coach.user) {
    const { passwordHash, refreshToken, ...safeUser } = coach.user;
    sanitized.user = safeUser;
  }
  return sanitized;
};