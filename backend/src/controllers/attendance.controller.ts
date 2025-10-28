/**
 * src/controllers/attendance.controller.ts
 * ---------------------------------------------------------
 * Manages attendance for athletes within sessions or programs.
 *  - Coaches can mark attendance for athletes.
 *  - Admins can view overall institutional attendance.
 *  - Athletes can view their own attendance records.
 *  - Data validation, duplicate prevention, and pagination supported.
 * ---------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🟢 Mark Attendance (Coach Only)
-------------------------------------------------------------------*/
export const markAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can mark attendance.");

    const { sessionId, athleteId, status, date } = req.body;

    if (!sessionId || !athleteId || !status)
      throw Errors.Validation("Missing required fields: sessionId, athleteId, status.");

    // Prevent duplicate attendance for same date & session
    const existing = await prisma.attendance.findFirst({
      where: {
        athleteId,
        sessionId,
        date: date ? new Date(date) : new Date(),
      },
    });

    if (existing)
      throw Errors.Duplicate("Attendance already marked for this athlete in this session.");

    const attendance = await prisma.attendance.create({
      data: {
        athleteId,
        coachId: requester.id,
        sessionId,
        status,
        date: date ? new Date(date) : new Date(),
      },
      include: {
        athlete: { select: { id: true, name: true } },
        session: { select: { id: true, name: true, date: true } },
      },
    });

    logger.info(`✅ Attendance marked by coach ${requester.id} for athlete ${athleteId}`);
    res.status(201).json({ success: true, message: "Attendance recorded.", data: attendance });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get Attendance (Paginated) — Coach/Admin
-------------------------------------------------------------------*/
export const getAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized access.");

    const whereClause: any = {};

    if (requester.role === "coach") {
      whereClause.coachId = requester.id;
    } else if (requester.role === "admin") {
      whereClause.institutionId = requester.institutionId;
    } else {
      throw Errors.Forbidden("Access restricted to coach/admin only.");
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.attendance.count({ where }),
      where: whereClause,
    });

    const data = await prisma.attendance.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        athlete: { select: { id: true, name: true } },
        session: { select: { id: true, name: true, date: true } },
      },
    });

    res.json({ success: true, data, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   👤 Athlete — View Own Attendance
-------------------------------------------------------------------*/
export const getMyAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester || requester.role !== "athlete")
      throw Errors.Forbidden("Only athletes can view their own attendance.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.attendance.count({ where }),
      where: { athleteId: requester.id },
    });

    const data = await prisma.attendance.findMany({
      ...prismaArgs,
      where: { athleteId: requester.id },
      include: { session: { select: { id: true, name: true, date: true } } },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✏️ Update Attendance (Coach/Admin)
-------------------------------------------------------------------*/
export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!["coach", "admin"].includes(requester?.role || ""))
      throw Errors.Forbidden("Only coach or admin can modify attendance.");

    const { id } = req.params;
    const updated = await prisma.attendance.update({ where: { id }, data: req.body });

    res.json({ success: true, message: "Attendance updated.", data: updated });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Attendance (Admin Only)
-------------------------------------------------------------------*/
export const deleteAttendance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (requester?.role !== "admin")
      throw Errors.Forbidden("Only admins can delete attendance records.");

    const { id } = req.params;
    await prisma.attendance.delete({ where: { id } });

    res.json({ success: true, message: "Attendance record deleted." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};