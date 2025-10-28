/**
 * src/controllers/assessments.controller.ts
 * ---------------------------------------------------------------------
 * Handles athlete assessments (physical, mental, and technical).
 * Features:
 *  - Coaches can create/update assessments for their athletes.
 *  - Admins can view all assessments in the institution.
 *  - Athletes can view their own assessment reports.
 *  - Supports pagination, role validation, and smart data checks.
 *  - Future-ready for AI performance analysis integration.
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🟢 Create Assessment (Coach only)
-------------------------------------------------------------------*/
export const createAssessment = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can create assessments.");

    const { athleteId, type, score, notes, date } = req.body;

    if (!athleteId || !type || score == null)
      throw Errors.Validation("Missing required fields: athleteId, type, score.");

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found.");

    const assessment = await prisma.assessment.create({
      data: {
        athleteId,
        coachId: requester.id,
        institutionId: requester.institutionId,
        type,
        score,
        notes,
        date: date ? new Date(date) : new Date(),
      },
      include: {
        athlete: { select: { id: true, name: true } },
        coach: { select: { id: true, name: true } },
      },
    });

    logger.info(`🧾 New assessment created by coach ${requester.id} for athlete ${athleteId}`);

    res.status(201).json({
      success: true,
      message: "Assessment created successfully.",
      data: assessment,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get Assessments (Paginated) — Coach/Admin
-------------------------------------------------------------------*/
export const getAssessments = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized access.");

    const whereClause: any = {};

    if (requester.role === "coach") {
      whereClause.coachId = requester.id;
    } else if (requester.role === "admin") {
      whereClause.institutionId = requester.institutionId;
    } else {
      throw Errors.Forbidden("Only admin or coach can view all assessments.");
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.assessment.count({ where }),
      where: whereClause,
    });

    const data = await prisma.assessment.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        athlete: { select: { id: true, name: true, sport: true } },
        coach: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👤 Athlete — View own assessments
-------------------------------------------------------------------*/
export const getMyAssessments = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "athlete")
      throw Errors.Forbidden("Only athletes can view their own assessments.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.assessment.count({ where }),
      where: { athleteId: requester.id },
    });

    const data = await prisma.assessment.findMany({
      ...prismaArgs,
      where: { athleteId: requester.id },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✏️ Update Assessment (Coach/Admin)
-------------------------------------------------------------------*/
export const updateAssessment = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (!["coach", "admin"].includes(requester?.role || ""))
      throw Errors.Forbidden("Only coach or admin can update assessments.");

    const updated = await prisma.assessment.update({
      where: { id },
      data: req.body,
    });

    res.json({
      success: true,
      message: "Assessment updated successfully.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Assessment (Admin)
-------------------------------------------------------------------*/
export const deleteAssessment = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (requester?.role !== "admin") throw Errors.Forbidden("Only admin can delete assessments.");

    const { id } = req.params;
    await prisma.assessment.delete({ where: { id } });

    res.json({ success: true, message: "Assessment deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};