/**
 * src/controllers/coach.controller.ts
 * ---------------------------------------------------------------------
 * Enterprise-grade controller for coach management.
 * Supports:
 * - Coach onboarding & admin approval
 * - Listing and filtering by institution
 * - Athlete association insights
 * - Role-safe access and pagination
 * - Clean deletion and update flows
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🆕 Register a Coach (requires institution link or invitation)
-------------------------------------------------------------------*/
export const registerCoach = async (req: Request, res: Response) => {
  try {
    const { name, sport, institutionCode, experienceYears } = req.body;

    if (!name || !sport || !institutionCode)
      throw Errors.Validation("Name, sport, and institution code are required.");

    const institution = await prisma.institution.findUnique({
      where: { code: institutionCode },
    });
    if (!institution) throw Errors.NotFound("Invalid institution code.");

    // Prevent duplicate coach for same user (if user already a coach)
    const existing = await prisma.coach.findFirst({
      where: { userId: req.user?.id },
    });
    if (existing)
      throw Errors.Duplicate("User is already registered as a coach.");

    const coach = await prisma.coach.create({
      data: {
        name,
        sport,
        experienceYears: Number(experienceYears) || null,
        userId: req.user?.id,
        institutionId: institution.id,
        approved: false, // pending admin approval
      },
    });

    res.status(201).json({
      success: true,
      message:
        "Coach registration submitted successfully. Awaiting admin approval.",
      data: coach,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✅ Approve or Reject Coach (admin only)
-------------------------------------------------------------------*/
export const approveCoach = async (req: Request, res: Response) => {
  try {
    const { coachId, approved } = req.body;
    const requester = req.user;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    const coach = await prisma.coach.update({
      where: { id: coachId },
      data: { approved },
    });

    res.json({
      success: true,
      message: approved
        ? "Coach approved successfully."
        : "Coach approval revoked or rejected.",
      data: coach,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get All Coaches (admin view)
-------------------------------------------------------------------*/
export const getAllCoaches = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where: { institutionId: requester.institutionId },
      countFn: (w) => prisma.coach.count({ where: w }),
      includeTotal: true,
    });

    const coaches = await prisma.coach.findMany({
      ...prismaArgs,
      where: { institutionId: requester.institutionId },
      include: {
        athletes: {
          select: { id: true, name: true, sport: true, approved: true },
        },
        institution: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: coaches, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Coach Profile (self or admin)
-------------------------------------------------------------------*/
export const getCoachById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized");

    const coach = await prisma.coach.findUnique({
      where: { id },
      include: {
        institution: { select: { id: true, name: true, code: true } },
        athletes: {
          select: { id: true, name: true, sport: true, approved: true },
        },
        sessions: {
          take: 5,
          orderBy: { date: "desc" },
        },
      },
    });

    if (!coach) throw Errors.NotFound("Coach not found.");

    // Access control: coach can only view self, admin can view within institution
    if (
      requester.role === "coach" &&
      requester.id !== coach.userId
    ) {
      throw Errors.Forbidden("Access denied.");
    }
    if (
      requester.role === "admin" &&
      coach.institutionId !== requester.institutionId
    ) {
      throw Errors.Forbidden("Cross-institution access denied.");
    }

    res.json({ success: true, data: coach });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✏️ Update Coach (self or admin)
-------------------------------------------------------------------*/
export const updateCoach = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    if (!requester) throw Errors.Auth("Unauthorized");
    const coach = await prisma.coach.findUnique({ where: { id } });
    if (!coach) throw Errors.NotFound("Coach not found.");

    // Access control
    if (requester.role === "coach" && requester.id !== coach.userId)
      throw Errors.Forbidden("You can only update your own profile.");
    if (
      requester.role === "admin" &&
      coach.institutionId !== requester.institutionId
    )
      throw Errors.Forbidden("Access denied.");

    const { name, sport, experienceYears } = req.body;

    const updatedCoach = await prisma.coach.update({
      where: { id },
      data: { name, sport, experienceYears },
    });

    logger.info(`Coach ${id} updated by ${requester.id}`);
    res.json({ success: true, data: updatedCoach });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Coach (admin only)
-------------------------------------------------------------------*/
export const deleteCoach = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    await prisma.coach.delete({ where: { id } });
    logger.warn(`Coach ${id} deleted by admin ${requester.id}`);

    res.json({ success: true, message: "Coach deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};