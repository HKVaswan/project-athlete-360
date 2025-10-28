/**
 * src/controllers/attendance.controller.ts
 * ---------------------------------------------------------------------
 * Handles attendance tracking for sessions and athletes.
 * Features:
 *  - Coaches can mark attendance for their athletes
 *  - Admins can view institution-wide attendance
 *  - Athletes can view their own attendance logs
 *  - Smart validation & future AI integration support
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🟢 Mark attendance (Coach only)
-------------------------------------------------------------------*/
export const markAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { sessionId, athleteId, status, notes } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can mark attendance.");

    if (!sessionId || !athleteId || !status)
      throw Errors.Validation("Missing required fields (sessionId, athleteId, status).");

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw Errors.NotFound("Session not found.");

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found.");

    const attendance = await prisma.attendance.upsert({
      where: { sessionId_athleteId: { sessionId, athleteId } },
      update: { status, notes, markedBy: requester.id },
      create: { sessionId, athleteId, status, notes, markedBy: requester.id },
      include: {
        athlete: { select: { id: true, name: true } },
        session: { select: { id: true, name: true, date: true } },
      },
    });

    logger.info(`Attendance marked for athlete ${athleteId} in session ${sessionId}`);

    res.status(201).json({
      success: true,
      message: "Attendance recorded successfully.",
      data: attendance,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get session attendance list (Coach/Admin)
-------------------------------------------------------------------*/
export const getSessionAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { sessionId } = req.params;

    if (!sessionId) throw Errors.Validation("Session ID is required.");
    if (!requester) throw Errors.Auth("Unauthorized.");

    const whereClause: any = { sessionId };

    if (requester.role === "coach" && requester.institutionId) {
      whereClause.session = { institutionId: requester.institutionId };
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.attendance.count({ where }),
      where: whereClause,
    });

    const attendance = await prisma.attendance.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        athlete: { select: { id: true, name: true, sport: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: attendance, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👤 Athlete view their own attendance
-------------------------------------------------------------------*/
export const getMyAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "athlete")
      throw Errors.Forbidden("Only athletes can access their attendance records.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.attendance.count({ where }),
      where: { athleteId: requester.id },
    });

    const attendance = await prisma.attendance.findMany({
      ...prismaArgs,
      where: { athleteId: requester.id },
      include: {
        session: { select: { id: true, name: true, date: true } },
      },
      orderBy: { date: "desc" },
    });

    res.json({
      success: true,
      data: attendance,
      meta,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧾 Update or delete attendance record (Coach/Admin)
-------------------------------------------------------------------*/
export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;
    if (!["coach", "admin"].includes(requester?.role || ""))
      throw Errors.Forbidden("Only coach or admin can update attendance.");

    const updated = await prisma.attendance.update({
      where: { id },
      data: req.body,
    });

    res.json({
      success: true,
      message: "Attendance updated successfully.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

export const deleteAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;
    if (!["coach", "admin"].includes(requester?.role || ""))
      throw Errors.Forbidden("Only coach or admin can delete attendance.");

    await prisma.attendance.delete({ where: { id } });

    res.json({ success: true, message: "Attendance deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};