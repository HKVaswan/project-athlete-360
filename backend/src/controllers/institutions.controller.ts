// src/controllers/institutions.controller.ts
/**
 * src/controllers/institutions.controller.ts
 * ---------------------------------------------------------------------
 * Enterprise-grade controller for institution management.
 * - Role-protected operations (admin / super_admin)
 * - Quota & plan enforcement
 * - Safe transactions for linking & approvals
 * - Auditing + notifications on critical actions
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";
import { recordAuditEvent } from "../services/audit.service";
import { notificationService } from "../services/notification.service";
import { quotaService } from "../services/quota.service";
import { plansService } from "../services/plans.service";

/**
 * Utility: minimal sanitizer for institution return
 */
const sanitizeInstitution = (inst: any) => {
  if (!inst) return inst;
  // drop any sensitive fields if present
  const { apiKey, secret, ...rest } = inst as any;
  return rest;
};

/**
 * Helper: require requester to be institution admin or super_admin
 */
const requireAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user) throw Errors.Auth("Not authenticated");
  if (!["admin", "super_admin", "institution_admin"].includes(user.role)) {
    throw Errors.Forbidden("Admin privileges required.");
  }
  return user;
};

/* ------------------------------------------------------------------
   🏫 Create Institution (Super Admin or global admin only)
   - institution creation by normal 'admin' is NOT allowed unless
     your product design permits it; here we restrict to super_admins.
-------------------------------------------------------------------*/
export const createInstitution = async (req: Request, res: Response) => {
  try {
    const user = requireAdmin(req);
    if (user.role !== "super_admin") {
      throw Errors.Forbidden("Only super admin may create top-level institutions.");
    }

    const { name, address, contactEmail, contactNumber, planId } = req.body;
    if (!name || typeof name !== "string") throw Errors.Validation("Institution name is required");

    // Validate chosen plan if provided
    let plan = null;
    if (planId) {
      plan = await plansService.getPlanById(planId);
      if (!plan) throw Errors.BadRequest("Invalid plan selected.");
    }

    // Generate unique institution code (ensure uniqueness)
    let code: string;
    for (let i = 0; i < 5; i++) {
      code = `INST-${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = await prisma.institution.findUnique({ where: { code } });
      if (!exists) break;
    }
    code = code!;

    const institution = await prisma.institution.create({
      data: {
        name,
        address,
        code,
        contactEmail,
        contactNumber,
        planId: plan?.id ?? null,
        createdBy: user.id,
      },
    });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "ADMIN_OVERRIDE",
      details: { event: "create_institution", institutionId: institution.id },
    });

    res.status(201).json({ success: true, data: sanitizeInstitution(institution) });
  } catch (err: any) {
    logger.error("[INSTITUTION] createInstitution failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 List Institutions (paginated) — super_admin only
-------------------------------------------------------------------*/
export const listInstitutions = async (req: Request, res: Response) => {
  try {
    const user = requireAdmin(req);
    if (user.role !== "super_admin") throw Errors.Forbidden("Super admin required.");

    const query = req.query;
    const pageMode = (query.mode as any) === "cursor" ? "cursor" : "offset";

    const { prismaArgs, meta } = await paginate(query as any, pageMode, {
      includeTotal: true,
      countFn: () => prisma.institution.count(),
    });

    // Add common includes (light-weight)
    prismaArgs.include = {
      _count: { select: { athletes: true, coaches: true } },
      admin: { select: { id: true, username: true, email: true } },
    };

    const institutions = await prisma.institution.findMany(prismaArgs as any);

    res.json({ success: true, data: institutions.map(sanitizeInstitution), meta });
  } catch (err: any) {
    logger.error("[INSTITUTION] listInstitutions failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Single Institution (with members)
   - Accessible to institution admin, super_admin, or any linked admin
-------------------------------------------------------------------*/
export const getInstitutionById = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    if (!id) throw Errors.Validation("Institution id required");

    const institution = await prisma.institution.findUnique({
      where: { id },
      include: {
        admin: { select: { id: true, username: true, email: true, role: true } },
        coaches: {
          include: { coach: { select: { id: true, name: true, userId: true, sport: true, approved: true } } },
        },
        athletes: { include: { user: { select: { id: true, username: true, email: true } } } },
        competitions: { select: { id: true, name: true, startDate: true, location: true } },
      },
    });

    if (!institution) throw Errors.NotFound("Institution not found.");

    // Permission: if not super_admin, ensure user is admin of this institution
    if (user?.role !== "super_admin") {
      if (!user || (institution.adminId && institution.adminId !== user.id)) {
        throw Errors.Forbidden("Access denied to institution details.");
      }
    }

    res.json({ success: true, data: sanitizeInstitution(institution) });
  } catch (err: any) {
    logger.error("[INSTITUTION] getInstitutionById failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👨‍🏫 Link Coach to Institution (Admin or Super Admin)
   - Enforces coach capacity per institution/plan
   - Idempotent (if already linked, returns success)
-------------------------------------------------------------------*/
export const linkCoachToInstitution = async (req: Request, res: Response) => {
  const tx = prisma.$transaction;
  try {
    const user = requireAdmin(req);
    const { coachId, institutionId } = req.body;

    if (!coachId || !institutionId) throw Errors.Validation("coachId and institutionId are required.");

    // Verify existence
    const [coach, institution] = await Promise.all([
      prisma.coach.findUnique({ where: { id: coachId }, include: { user: true } }),
      prisma.institution.findUnique({ where: { id: institutionId }, include: { plan: true } }),
    ]);
    if (!coach) throw Errors.NotFound("Coach not found.");
    if (!institution) throw Errors.NotFound("Institution not found.");

    // Permission check: only super_admin or institution admin may link
    if (user.role !== "super_admin" && institution.adminId !== user.id) {
      throw Errors.Forbidden("Only institution admin or super_admin may link coaches.");
    }

    // Check coach is not already linked (idempotency)
    if (coach.institutionId === institutionId) {
      return res.json({ success: true, message: "Coach is already linked to this institution." });
    }

    // Check plan/quota: number of coaches allowed for plan (if applicable)
    const canAddCoach = await quotaService.canAddCoachToInstitution(institutionId);
    if (!canAddCoach.ok) {
      throw Errors.BadRequest(canAddCoach.reason || "Coach quota reached for this institution's plan.");
    }

    // Transactionally update coach and create association if required
    await prisma.$transaction(async (t) => {
      await t.coach.update({ where: { id: coachId }, data: { institutionId: institutionId } });

      // Optionally create coachInstitution record if your schema has it
      try {
        await t.coachInstitution.upsert({
          where: { coachId_institutionId: { coachId, institutionId } as any },
          update: {},
          create: { coachId, institutionId },
        });
      } catch (e) {
        // ignore unique constraint race
      }
    });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "DATA_UPDATE",
      details: { event: "link_coach", coachId, institutionId },
    });

    res.json({ success: true, message: "Coach linked successfully to institution." });
  } catch (err: any) {
    logger.error("[INSTITUTION] linkCoachToInstitution failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧍 Athlete joins Institution (via code) — athlete triggers request
   - Ensure institution has quota before linking
   - Leaves athlete in 'pending' approval state for the institution admin
-------------------------------------------------------------------*/
export const requestAthleteJoin = async (req: Request, res: Response) => {
  try {
    const { institutionCode } = req.body;
    const requester = (req as any).user;

    if (!requester || requester.role !== "athlete") throw Errors.Forbidden("Only athletes may request to join.");

    if (!institutionCode) throw Errors.Validation("Institution code is required.");

    const institution = await prisma.institution.findUnique({ where: { code: institutionCode }, include: { plan: true } });
    if (!institution) throw Errors.NotFound("Invalid institution code.");

    // Check institution quota (total athletes allowed)
    const quotaOk = await quotaService.canAddAthleteToInstitution(institution.id);
    if (!quotaOk.ok) {
      throw Errors.BadRequest(quotaOk.reason || "Institution athlete quota reached for current plan.");
    }

    // Idempotent update: set institutionId and mark approved=false
    const athlete = await prisma.athlete.update({
      where: { userId: requester.id },
      data: { institutionId: institution.id, approved: false, requestedAt: new Date() },
    });

    // Notify institution admins/coaches about pending request
    try {
      const admins = await prisma.user.findMany({ where: { institutionId: institution.id, role: "admin" }, select: { id: true, email: true } });
      const adminIds = admins.map((a) => a.id);
      await notificationService.sendBulk({
        userIds: adminIds,
        title: "New Athlete Join Request",
        body: `${athlete.name || requester.username} requested to join ${institution.name}.`,
        meta: { athleteId: athlete.id, institutionId: institution.id },
      });
    } catch (e) {
      logger.warn("[INSTITUTION] Failed to notify admins about join request", e);
    }

    await recordAuditEvent({
      actorId: requester.id,
      actorRole: "athlete",
      action: "DATA_UPDATE",
      details: { event: "athlete_request_join", athleteId: athlete.id, institutionId: institution.id },
    });

    res.json({ success: true, message: "Join request submitted successfully. Awaiting approval.", data: athlete });
  } catch (err: any) {
    logger.error("[INSTITUTION] requestAthleteJoin failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✅ Approve or Reject Athlete (Institution Admin or Super Admin)
   - Enforces quotas when approving (final check)
-------------------------------------------------------------------*/
export const updateAthleteApproval = async (req: Request, res: Response) => {
  try {
    const user = requireAdmin(req);
    const { athleteId, approved } = req.body;
    if (!athleteId || typeof approved !== "boolean") throw Errors.Validation("athleteId and approved(boolean) are required.");

    // fetch athlete + institution
    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found.");
    if (!athlete.institutionId) throw Errors.BadRequest("Athlete has not requested to join any institution.");

    const institution = await prisma.institution.findUnique({ where: { id: athlete.institutionId }, include: { plan: true } });
    if (!institution) throw Errors.NotFound("Institution not found.");

    // Permission: user must be institution admin or super_admin
    if (user.role !== "super_admin" && institution.adminId !== user.id) throw Errors.Forbidden("Only institution admin or super_admin may approve athletes.");

    // If approving, final quota check
    if (approved) {
      const quotaOk = await quotaService.canAddAthleteToInstitution(institution.id);
      if (!quotaOk.ok) throw Errors.BadRequest(quotaOk.reason || "Institution quota reached.");
    }

    const updated = await prisma.athlete.update({
      where: { id: athleteId },
      data: { approved, approvedBy: user.id, approvedAt: approved ? new Date() : null },
    });

    // notify athlete about approval/rejection
    try {
      await notificationService.send({
        userId: updated.userId,
        title: approved ? "Athlete Approved" : "Athlete Request Rejected",
        body: approved ? `Your request to join ${institution.name} has been approved.` : `Your request to join ${institution.name} was rejected.`,
        meta: { institutionId: institution.id },
      });
    } catch (e) {
      logger.warn("[INSTITUTION] Failed to notify athlete about approval", e);
    }

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "DATA_UPDATE",
      details: { event: "athlete_approval", athleteId, approved, institutionId: institution.id },
    });

    res.json({ success: true, message: approved ? "Athlete approved." : "Athlete rejected.", data: updated });
  } catch (err: any) {
    logger.error("[INSTITUTION] updateAthleteApproval failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ❌ Delete Institution (super_admin only) — safe cascading
   - Uses soft-delete if schema supports `deletedAt`; otherwise hard delete
-------------------------------------------------------------------*/
export const deleteInstitution = async (req: Request, res: Response) => {
  try {
    const user = requireAdmin(req);
    if (user.role !== "super_admin") throw Errors.Forbidden("Only super_admin may delete an institution.");

    const { id } = req.params;
    if (!id) throw Errors.Validation("Institution id required.");

    // Prefer soft-delete: check if model has deletedAt
    const hasDeletedAt = (await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='Institution' AND column_name='deletedAt'`).length > 0;

    if (hasDeletedAt) {
      await prisma.institution.update({ where: { id }, data: { deletedAt: new Date() } });
    } else {
      // Hard delete with transaction to avoid orphaned records
      await prisma.$transaction(async (t) => {
        // delete dependent rows where appropriate (be conservative)
        await t.athlete.updateMany({ where: { institutionId: id }, data: { institutionId: null } });
        await t.coach.updateMany({ where: { institutionId: id }, data: { institutionId: null } });
        await t.institution.delete({ where: { id } });
      });
    }

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "ADMIN_OVERRIDE",
      details: { event: "delete_institution", institutionId: id },
    });

    logger.warn(`Institution ${id} deleted by ${user.id}`);

    res.json({ success: true, message: "Institution removed successfully." });
  } catch (err: any) {
    logger.error("[INSTITUTION] deleteInstitution failed", { err });
    sendErrorResponse(res, err);
  }
};