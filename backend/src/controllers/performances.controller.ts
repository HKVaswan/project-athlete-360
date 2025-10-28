/**
 * src/controllers/performances.controller.ts
 * ---------------------------------------------------------------------
 * Handles athlete performance tracking and analytics.
 * Features:
 *  - Add, update, and fetch athlete performance metrics
 *  - Supports automated linking with sessions/assessments
 *  - Includes trend analysis placeholders for AI integration
 *  - Secure role-based access control
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🧠 Add new performance record (Coach only)
-------------------------------------------------------------------*/
export const addPerformance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { athleteId, sessionId, assessmentType, score, notes } = req.body;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can record performances.");

    if (!athleteId || !assessmentType || score === undefined)
      throw Errors.Validation("Missing required fields.");

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found.");

    const performance = await prisma.performance.create({
      data: {
        athleteId,
        sessionId: sessionId || null,
        assessmentType,
        score: parseFloat(score),
        notes,
        recordedBy: requester.id,
        date: new Date(),
      },
      include: {
        athlete: { select: { id: true, name: true, sport: true } },
      },
    });

    logger.info(`Performance recorded for athlete ${athleteId} by ${requester.username}`);

    res.status(201).json({
      success: true,
      message: "Performance record created successfully.",
      data: performance,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📊 Get all performance records (supports filters)
-------------------------------------------------------------------*/
export const getPerformances = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { athleteId, sessionId, assessmentType } = req.query;

    if (!requester) throw Errors.Auth("Unauthorized.");

    const whereClause: any = {};
    if (athleteId) whereClause.athleteId = String(athleteId);
    if (sessionId) whereClause.sessionId = String(sessionId);
    if (assessmentType) whereClause.assessmentType = String(assessmentType);

    // Coaches see only their institution athletes
    if (requester.role === "coach" && requester.institutionId) {
      whereClause.athlete = { institutionId: requester.institutionId };
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.performance.count({ where }),
      where: whereClause,
    });

    const performances = await prisma.performance.findMany({
      ...prismaArgs,
      where: whereClause,
      include: {
        athlete: { select: { id: true, name: true, sport: true } },
        session: { select: { id: true, name: true, date: true } },
      },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data: performances, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get performance trend (athlete-wise) — Future AI integration ready
-------------------------------------------------------------------*/
export const getAthletePerformanceTrend = async (req: Request, res: Response) => {
  try {
    const { athleteId } = req.params;
    if (!athleteId) throw Errors.Validation("Athlete ID is required.");

    const records = await prisma.performance.findMany({
      where: { athleteId },
      orderBy: { date: "asc" },
      select: { score: true, date: true, assessmentType: true },
    });

    if (!records.length) throw Errors.NotFound("No performance data found.");

    // Placeholder for AI predictive analysis (future integration)
    const averageScore = records.reduce((acc, r) => acc + r.score, 0) / records.length;

    res.json({
      success: true,
      data: {
        totalRecords: records.length,
        averageScore,
        trend: records, // could be processed later into a chart-friendly array
      },
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📝 Update performance record (Coach only)
-------------------------------------------------------------------*/
export const updatePerformance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (!requester || requester.role !== "coach")
      throw Errors.Forbidden("Only coaches can update performance data.");

    const updated = await prisma.performance.update({
      where: { id },
      data: req.body,
    });

    logger.info(`Performance ${id} updated by ${requester.username}`);

    res.json({
      success: true,
      message: "Performance record updated successfully.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ❌ Delete performance record (Coach or Admin)
-------------------------------------------------------------------*/
export const deletePerformance = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (!requester || !["coach", "admin"].includes(requester.role))
      throw Errors.Forbidden("Not authorized to delete performance data.");

    await prisma.performance.delete({ where: { id } });

    logger.warn(`Performance ${id} deleted by ${requester.username}`);

    res.json({ success: true, message: "Performance record deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};