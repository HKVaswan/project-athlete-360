/**
 * src/controllers/coach.controller.ts
 * ---------------------------------------------------------------------
 * Handles all coach-related operations:
 * - Managing assigned athletes
 * - Viewing & filtering session/performance data
 * - Providing athlete feedback
 * - Dashboard insights
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* -----------------------------------------------------------------------
   📊 Get Coach Dashboard Overview
------------------------------------------------------------------------*/
export const getCoachDashboard = async (req: Request, res: Response) => {
  try {
    const coachId = req.user?.id;
    if (!coachId) throw Errors.Auth("Unauthorized access");

    const [athleteCount, sessionCount, latestSessions] = await Promise.all([
      prisma.athlete.count({ where: { coachId } }),
      prisma.session.count({ where: { coachId } }),
      prisma.session.findMany({
        where: { coachId },
        orderBy: { date: "desc" },
        take: 5,
        include: { athlete: { select: { name: true } } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        athleteCount,
        sessionCount,
        latestSessions,
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   👥 Get All Athletes Assigned to Coach
------------------------------------------------------------------------*/
export const getCoachAthletes = async (req: Request, res: Response) => {
  try {
    const coachId = req.user?.id;
    if (!coachId) throw Errors.Auth("Unauthorized");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where: { coachId },
      countFn: (where) => prisma.athlete.count({ where }),
      includeTotal: true,
    });

    const athletes = await prisma.athlete.findMany({
      ...prismaArgs,
      where: { coachId },
      include: {
        performances: { take: 3, orderBy: { date: "desc" } },
        attendance: { take: 3, orderBy: { date: "desc" } },
      },
    });

    res.json({ success: true, data: athletes, meta });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🗓️ Get All Sessions Conducted by Coach
------------------------------------------------------------------------*/
export const getCoachSessions = async (req: Request, res: Response) => {
  try {
    const coachId = req.user?.id;
    if (!coachId) throw Errors.Auth("Unauthorized");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where: { coachId },
      countFn: (where) => prisma.session.count({ where }),
      includeTotal: true,
    });

    const sessions = await prisma.session.findMany({
      ...prismaArgs,
      where: { coachId },
      include: {
        athlete: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: sessions, meta });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ✍️ Provide Feedback to an Athlete
------------------------------------------------------------------------*/
export const addAthleteFeedback = async (req: Request, res: Response) => {
  try {
    const coachId = req.user?.id;
    const { athleteId, feedback, rating } = req.body;

    if (!coachId) throw Errors.Auth("Unauthorized");
    if (!athleteId || !feedback) throw Errors.Validation("Missing fields");

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found");

    const entry = await prisma.feedback.create({
      data: {
        coachId,
        athleteId,
        feedback,
        rating: rating ? Number(rating) : null,
      },
    });

    logger.info(`🗒️ Feedback added by coach ${coachId} for athlete ${athleteId}`);
    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📈 Get Coach Performance Summary
------------------------------------------------------------------------*/
export const getCoachPerformanceSummary = async (req: Request, res: Response) => {
  try {
    const coachId = req.user?.id;
    if (!coachId) throw Errors.Auth("Unauthorized");

    const athletes = await prisma.athlete.findMany({
      where: { coachId },
      include: { performances: true },
    });

    const totalAthletes = athletes.length;
    const avgPerformance =
      totalAthletes > 0
        ? (
            athletes.reduce((sum, athlete) => {
              const scores = athlete.performances.map((p) => p.score || 0);
              const avg =
                scores.length > 0
                  ? scores.reduce((a, b) => a + b, 0) / scores.length
                  : 0;
              return sum + avg;
            }, 0) / totalAthletes
          ).toFixed(2)
        : 0;

    res.json({
      success: true,
      data: {
        totalAthletes,
        avgPerformance: Number(avgPerformance),
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};