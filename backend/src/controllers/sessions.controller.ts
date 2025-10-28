/**
 * src/controllers/sessions.controller.ts
 * ---------------------------------------------------------------------
 * Manages training sessions and attendance tracking.
 * Supports:
 *  - Session creation (coach-only)
 *  - Athlete assignment and participation tracking
 *  - Real-time status updates (planned, ongoing, completed)
 *  - Pagination for scalable listings
 *  - Role-based filtering and access control
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🧩 Create a Training Session (Coach only)
-------------------------------------------------------------------*/
export const createSession = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { name, date, duration, notes, athletes = [], location } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can create sessions.");

    if (!name || !date)
      throw Errors.Validation("Session name and date are required.");

    const session = await prisma.session.create({
      data: {
        name,
        date: new Date(date),
        duration,
        notes,
        location,
        coachId: requester.id,
        institutionId: requester.institutionId ?? null,
        status: "PLANNED",
        athletes: {
          connect: athletes.map((id: string) => ({ id })),
        },
      },
      include: {
        athletes: { select: { id: true, name: true } },
      },
    });

    logger.info(`🧠 Session created by ${requester.username}: ${session.name}`);

    res.status(201).json({
      success: true,
      message: "Training session created successfully.",
      data: session,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get All Sessions (Paginated)
   Coaches → see their sessions
   Athletes → see assigned sessions
-------------------------------------------------------------------*/
export const getSessions = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { status } = req.query;

    if (!requester) throw Errors.Auth("Unauthorized.");

    const whereClause: any = {};
    if (status) whereClause.status = String(status).toUpperCase();

    if (requester.role === "coach") {
      whereClause.coachId = requester.id;
    } else if (requester.role === "athlete") {
      whereClause.athletes = { some: { userId: requester.id } };
    } else if (requester.role === "admin" && requester.institutionId) {
      whereClause.institutionId = requester.institutionId;
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.session.count({ where }),
      where: whereClause,
    });

    const sessions = await prisma.session.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        coach: { select: { id: true, name: true } },
        athletes: { select: { id: true, name: true, sport: true } },
      },
    });

    res.json({ success: true, data: sessions, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Single Session Detail (with Attendance + Notes)
-------------------------------------------------------------------*/
export const getSessionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        coach: { select: { id: true, name: true, username: true } },
        athletes: {
          select: {
            id: true,
            name: true,
            athleteCode: true,
            sport: true,
            attendance: {
              where: { sessionId: id },
              select: { status: true, recordedAt: true },
            },
          },
        },
      },
    });

    if (!session) throw Errors.NotFound("Session not found.");

    res.json({ success: true, data: session });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧍 Add Athlete to Session (Coach only)
-------------------------------------------------------------------*/
export const addAthleteToSession = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { sessionId, athleteId } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can modify sessions.");
    if (!sessionId || !athleteId)
      throw Errors.Validation("sessionId and athleteId are required.");

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        athletes: { connect: { id: athleteId } },
      },
      include: {
        athletes: { select: { id: true, name: true } },
      },
    });

    logger.info(`Athlete ${athleteId} added to session ${sessionId}`);

    res.json({
      success: true,
      message: "Athlete added to session successfully.",
      data: session,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗓️ Update Session Status (planned → ongoing → completed)
-------------------------------------------------------------------*/
export const updateSessionStatus = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { sessionId, status } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can update session status.");

    const validStatuses = ["PLANNED", "ONGOING", "COMPLETED"];
    if (!validStatuses.includes(status))
      throw Errors.Validation("Invalid status value.");

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: { status },
    });

    logger.info(`Session ${sessionId} status updated to ${status}`);

    res.json({
      success: true,
      message: `Session status updated to ${status}.`,
      data: session,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📝 Add or Update Session Notes
-------------------------------------------------------------------*/
export const updateSessionNotes = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { sessionId, notes } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can update notes.");

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: { notes },
    });

    res.json({
      success: true,
      message: "Session notes updated successfully.",
      data: session,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ❌ Delete a Session (Coach or Admin)
-------------------------------------------------------------------*/
export const deleteSession = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (!requester || !["coach", "admin"].includes(requester.role))
      throw Errors.Forbidden("Not authorized to delete sessions.");

    await prisma.session.delete({ where: { id } });

    logger.warn(`Session ${id} deleted by ${requester.username}`);

    res.json({ success: true, message: "Session deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};