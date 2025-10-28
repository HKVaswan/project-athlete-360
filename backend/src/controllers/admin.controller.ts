/**
 * src/controllers/admin.controller.ts
 * ---------------------------------------------------------------------
 * Core admin controller — manages:
 * - Institution overview (analytics, stats)
 * - Coach & athlete management
 * - Billing and plan validation
 * - Admin approval flow for pending coaches/athletes
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* -----------------------------------------------------------------------
   🏫 Get Institution Dashboard Overview
------------------------------------------------------------------------*/
export const getInstitutionDashboard = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw Errors.Auth("Unauthorized");

    const institution = await prisma.institution.findFirst({
      where: { adminId },
      include: {
        _count: { select: { coaches: true, athletes: true, sessions: true } },
      },
    });

    if (!institution) throw Errors.NotFound("Institution not found");

    const recentSessions = await prisma.session.findMany({
      where: { institutionId: institution.id },
      orderBy: { date: "desc" },
      take: 5,
      include: { coach: { select: { name: true } } },
    });

    res.json({
      success: true,
      data: {
        institution,
        stats: {
          coaches: institution._count.coaches,
          athletes: institution._count.athletes,
          sessions: institution._count.sessions,
        },
        recentSessions,
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   👥 Get All Coaches Under Institution
------------------------------------------------------------------------*/
export const getInstitutionCoaches = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw Errors.Auth("Unauthorized");

    const institution = await prisma.institution.findFirst({ where: { adminId } });
    if (!institution) throw Errors.NotFound("Institution not found");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where: { institutionId: institution.id },
      countFn: (where) => prisma.coach.count({ where }),
      includeTotal: true,
    });

    const coaches = await prisma.coach.findMany({
      ...prismaArgs,
      where: { institutionId: institution.id },
      include: {
        _count: { select: { athletes: true, sessions: true } },
      },
    });

    res.json({ success: true, data: coaches, meta });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧑‍🎓 Get All Athletes Under Institution
------------------------------------------------------------------------*/
export const getInstitutionAthletes = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw Errors.Auth("Unauthorized");

    const institution = await prisma.institution.findFirst({ where: { adminId } });
    if (!institution) throw Errors.NotFound("Institution not found");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where: { institutionId: institution.id },
      countFn: (where) => prisma.athlete.count({ where }),
      includeTotal: true,
    });

    const athletes = await prisma.athlete.findMany({
      ...prismaArgs,
      where: { institutionId: institution.id },
      include: {
        coach: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: athletes, meta });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ✅ Approve or Reject Pending Coaches
------------------------------------------------------------------------*/
export const updateCoachStatus = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    const { coachId, status } = req.body;

    if (!adminId) throw Errors.Auth("Unauthorized");
    if (!coachId || !["approved", "rejected"].includes(status))
      throw Errors.Validation("Invalid status or coachId");

    const coach = await prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) throw Errors.NotFound("Coach not found");

    await prisma.coach.update({
      where: { id: coachId },
      data: { status },
    });

    logger.info(`👨‍🏫 Coach ${coachId} ${status} by admin ${adminId}`);
    res.json({ success: true, message: `Coach ${status} successfully` });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   💳 Manage Subscription / Billing Info
------------------------------------------------------------------------*/
export const getBillingDetails = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw Errors.Auth("Unauthorized");

    const institution = await prisma.institution.findFirst({
      where: { adminId },
      include: { billing: true },
    });

    if (!institution) throw Errors.NotFound("Institution not found");

    res.json({ success: true, data: institution.billing });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧾 Update Billing / Subscription Plan
------------------------------------------------------------------------*/
export const updateBillingPlan = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    const { planType, paymentStatus } = req.body;

    if (!adminId) throw Errors.Auth("Unauthorized");
    if (!planType) throw Errors.Validation("Plan type is required");

    const institution = await prisma.institution.findFirst({ where: { adminId } });
    if (!institution) throw Errors.NotFound("Institution not found");

    const updated = await prisma.billing.upsert({
      where: { institutionId: institution.id },
      create: {
        institutionId: institution.id,
        planType,
        paymentStatus: paymentStatus || "pending",
      },
      update: {
        planType,
        paymentStatus: paymentStatus || "active",
        updatedAt: new Date(),
      },
    });

    logger.info(`💰 Billing updated for institution ${institution.id}`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};