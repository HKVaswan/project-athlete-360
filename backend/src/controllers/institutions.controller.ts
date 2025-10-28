/**
 * src/controllers/institutions.controller.ts
 * ---------------------------------------------------------------------
 * Enterprise-grade controller for institution management.
 * Features:
 * - Secure admin-only institution creation
 * - Coach and athlete linking
 * - Approval workflows
 * - Pagination for large data sets
 * - Optimized queries for performance
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

// Helper: Generate unique institution code
const generateInstitutionCode = () => `INST-${Math.floor(1000 + Math.random() * 9000)}`;

/* ------------------------------------------------------------------
   🏫 Create Institution (Admin only)
-------------------------------------------------------------------*/
export const createInstitution = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { name, address, contactEmail, contactNumber } = req.body;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Only admins can create institutions.");

    if (!name) throw Errors.Validation("Institution name is required.");

    const code = generateInstitutionCode();

    const institution = await prisma.institution.create({
      data: {
        name,
        address,
        code,
        contactEmail,
        contactNumber,
        adminId: requester.id,
      },
    });

    logger.info(`🏫 Institution created: ${institution.name} (${institution.code})`);

    res.status(201).json({
      success: true,
      message: "Institution created successfully.",
      data: institution,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get All Institutions (Admin view with pagination)
-------------------------------------------------------------------*/
export const listInstitutions = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (w) => prisma.institution.count({ where: w }),
    });

    const institutions = await prisma.institution.findMany({
      ...prismaArgs,
      include: {
        coaches: {
          select: {
            coach: { select: { id: true, name: true, sport: true, approved: true } },
          },
        },
        athletes: {
          select: { id: true, name: true, sport: true, approved: true },
        },
      },
    });

    res.json({ success: true, data: institutions, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Single Institution (with members)
-------------------------------------------------------------------*/
export const getInstitutionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const institution = await prisma.institution.findUnique({
      where: { id },
      include: {
        admin: { select: { id: true, username: true, email: true } },
        coaches: {
          include: {
            coach: { select: { id: true, name: true, sport: true, approved: true } },
          },
        },
        athletes: {
          include: {
            user: { select: { id: true, username: true, email: true } },
          },
        },
        competitions: {
          select: { id: true, name: true, startDate: true, location: true },
        },
      },
    });

    if (!institution) throw Errors.NotFound("Institution not found.");

    res.json({ success: true, data: institution });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👨‍🏫 Link Coach to Institution (Admin only)
-------------------------------------------------------------------*/
export const linkCoachToInstitution = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { coachId, institutionId } = req.body;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");
    if (!coachId || !institutionId)
      throw Errors.Validation("coachId and institutionId are required.");

    const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw Errors.NotFound("Institution not found.");

    const coach = await prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) throw Errors.NotFound("Coach not found.");

    await prisma.coach.update({
      where: { id: coachId },
      data: { institutionId: institution.id },
    });

    logger.info(`Coach ${coachId} linked to institution ${institution.name}`);

    res.json({
      success: true,
      message: "Coach linked successfully to institution.",
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧍 Athlete joins Institution (via code)
-------------------------------------------------------------------*/
export const requestAthleteJoin = async (req: Request, res: Response) => {
  try {
    const { institutionCode } = req.body;
    const requester = req.user;

    if (!requester || requester.role !== "athlete")
      throw Errors.Forbidden("Only athletes can join an institution.");

    const institution = await prisma.institution.findUnique({
      where: { code: institutionCode },
    });
    if (!institution) throw Errors.NotFound("Invalid institution code.");

    // Update athlete profile to link institution
    const athlete = await prisma.athlete.update({
      where: { userId: requester.id },
      data: { institutionId: institution.id, approved: false },
    });

    logger.info(`Athlete ${athlete.name} requested to join ${institution.name}`);

    res.status(200).json({
      success: true,
      message: "Join request submitted successfully. Awaiting approval.",
      data: athlete,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✅ Approve or Reject Athlete (Institution Admin)
-------------------------------------------------------------------*/
export const updateAthleteApproval = async (req: Request, res: Response) => {
  try {
    const { athleteId, approved } = req.body;
    const requester = req.user;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    const athlete = await prisma.athlete.update({
      where: { id: athleteId },
      data: {
        approved,
        approvedBy: requester.id,
      },
    });

    res.json({
      success: true,
      message: approved
        ? "Athlete approved successfully."
        : "Athlete request rejected.",
      data: athlete,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ❌ Delete Institution (admin only, safe cascading)
-------------------------------------------------------------------*/
export const deleteInstitution = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin privileges required.");

    await prisma.institution.delete({ where: { id } });
    logger.warn(`Institution ${id} deleted by admin ${requester.id}`);

    res.json({ success: true, message: "Institution deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};