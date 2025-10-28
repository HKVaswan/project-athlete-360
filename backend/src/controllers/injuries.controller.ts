/**
 * src/controllers/injuries.controller.ts
 * ---------------------------------------------------------
 * Handles athlete injury and recovery records.
 * - Coaches can log or update injuries for their athletes.
 * - Athletes can view their own injury history.
 * - Admins can view and analyze injuries across the institution.
 * - Ensures data integrity, safety, and traceability.
 * ---------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🩹 Record Injury (Coach)
-------------------------------------------------------------------*/
export const recordInjury = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can record athlete injuries.");

    const { athleteId, description, severity, date, recoveryStatus } = req.body;

    if (!athleteId || !description || !severity)
      throw Errors.Validation("Missing required fields: athleteId, description, severity.");

    const injury = await prisma.injury.create({
      data: {
        athleteId,
        coachId: requester.id,
        description,
        severity,
        date: date ? new Date(date) : new Date(),
        recoveryStatus: recoveryStatus || "ongoing",
      },
      include: {
        athlete: { select: { id: true, name: true } },
      },
    });

    logger.info(`🩹 Injury recorded by coach ${requester.id} for athlete ${athleteId}`);
    res.status(201).json({ success: true, message: "Injury recorded successfully.", data: injury });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 View Athlete Injuries (Coach/Admin)
-------------------------------------------------------------------*/
export const getInjuries = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester) throw Errors.Auth();

    const whereClause: any = {};

    if (requester.role === "coach") {
      whereClause.coachId = requester.id;
    } else if (requester.role === "admin") {
      whereClause.institutionId = requester.institutionId;
    } else {
      throw Errors.Forbidden("Access denied.");
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.injury.count({ where }),
      where: whereClause,
    });

    const data = await prisma.injury.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        athlete: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👤 Athlete View — My Injury History
-------------------------------------------------------------------*/
export const getMyInjuries = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "athlete")
      throw Errors.Forbidden("Only athletes can view their own injury history.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.injury.count({ where }),
      where: { athleteId: requester.id },
    });

    const data = await prisma.injury.findMany({
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
   ♻️ Update Injury Record (Coach/Admin)
-------------------------------------------------------------------*/
export const updateInjury = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!["coach", "admin"].includes(requester?.role || ""))
      throw Errors.Forbidden("Only coaches or admins can update injury records.");

    const { id } = req.params;

    const updated = await prisma.injury.update({
      where: { id },
      data: req.body,
    });

    res.json({ success: true, message: "Injury record updated successfully.", data: updated });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Injury (Admin)
-------------------------------------------------------------------*/
export const deleteInjury = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (requester?.role !== "admin")
      throw Errors.Forbidden("Only admins can delete injury records.");

    const { id } = req.params;
    await prisma.injury.delete({ where: { id } });

    res.json({ success: true, message: "Injury record deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};