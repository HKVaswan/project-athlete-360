/**
 * src/controllers/athletes.controller.ts
 * ---------------------------------------------------------------------
 * Handles all athlete-related operations.
 * Includes: CRUD, approvals, performance tracking, linking to institutions.
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* -----------------------------------------------------------------------
   📜 Get All Athletes (Paginated, Filtered)
------------------------------------------------------------------------*/
export const getAllAthletes = async (req: Request, res: Response) => {
  try {
    const { institutionId, coachId, sport, gender } = req.query;

    const where: any = {};
    if (institutionId) where.institutionId = String(institutionId);
    if (coachId) where.coachId = String(coachId);
    if (sport) where.sport = String(sport);
    if (gender) where.gender = String(gender);

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      countFn: (where) => prisma.athlete.count({ where }),
      where,
      includeTotal: true,
    });

    const athletes = await prisma.athlete.findMany({
      ...prismaArgs,
      include: {
        user: { select: { username: true, email: true, role: true } },
        institution: { select: { name: true } },
        coach: { select: { name: true } },
      },
    });

    meta.total = await prisma.athlete.count({ where });

    res.json({ success: true, data: athletes, meta });
  } catch (err: any) {
    logger.error("❌ Error fetching athletes:", err.message);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   👤 Get Athlete by ID
------------------------------------------------------------------------*/
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        user: { select: { username: true, email: true, role: true } },
        coach: { select: { name: true } },
        institution: { select: { name: true } },
        performances: true,
        attendance: true,
      },
    });

    if (!athlete) throw Errors.NotFound("Athlete not found");

    res.json({ success: true, data: athlete });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🆕 Create Athlete (Admin/Coach only)
------------------------------------------------------------------------*/
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, dob, gender, sport, institutionId, email, phone, coachId } = req.body;

    if (!name || !institutionId) throw Errors.Validation("Missing required fields");

    const athlete = await prisma.athlete.create({
      data: {
        name,
        dob: dob ? new Date(dob) : null,
        gender,
        sport,
        contactInfo: email || phone || null,
        institution: { connect: { id: institutionId } },
        ...(coachId && { coach: { connect: { id: coachId } } }),
      },
    });

    logger.info(`✅ New athlete created: ${athlete.name}`);

    res.status(201).json({ success: true, data: athlete });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ✏️ Update Athlete Info
------------------------------------------------------------------------*/
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.athlete.findUnique({ where: { id } });
    if (!existing) throw Errors.NotFound("Athlete not found");

    const updated = await prisma.athlete.update({
      where: { id },
      data: req.body,
    });

    logger.info(`🔁 Athlete updated: ${updated.name}`);

    res.json({ success: true, data: updated });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚫 Delete Athlete (Admin-only)
------------------------------------------------------------------------*/
export const deleteAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) throw Errors.NotFound("Athlete not found");

    await prisma.athlete.delete({ where: { id } });
    logger.info(`🗑️ Athlete deleted: ${athlete.name}`);

    res.json({ success: true, message: "Athlete deleted successfully" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ✅ Approve Athlete (Coach/Admin)
------------------------------------------------------------------------*/
export const approveAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) throw Errors.NotFound("Athlete not found");

    const updated = await prisma.athlete.update({
      where: { id },
      data: { approved: true, approvedBy, approvedAt: new Date() },
    });

    logger.info(`🏅 Athlete approved: ${updated.name}`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📊 Get Athlete Performance Overview
------------------------------------------------------------------------*/
export const getAthletePerformance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const performances = await prisma.performance.findMany({
      where: { athleteId: id },
      orderBy: { date: "desc" },
      take: 20, // limit to recent 20 entries
    });

    res.json({
      success: true,
      data: performances,
      summary: {
        totalSessions: performances.length,
        avgScore:
          performances.length > 0
            ? performances.reduce((sum, p) => sum + (p.score || 0), 0) / performances.length
            : null,
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📆 Get Athlete Attendance Overview
------------------------------------------------------------------------*/
export const getAthleteAttendance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const attendance = await prisma.attendance.findMany({
      where: { athleteId: id },
      orderBy: { date: "desc" },
      take: 50,
    });

    res.json({
      success: true,
      data: attendance,
      summary: {
        totalSessions: attendance.length,
        presentCount: attendance.filter((a) => a.status === "present").length,
        absentCount: attendance.filter((a) => a.status === "absent").length,
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};