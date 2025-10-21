// src/controllers/performance.controller.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// ───────────────────────────────
// Get detailed performance records for an athlete
export async function getPerformance(req: Request, res: Response) {
  try {
    const { athleteId } = req.params;

    const performances = await prisma.performance.findMany({
      where: { athleteId },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data: performances });
  } catch (err) {
    logger.error("Failed to fetch performance records: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch performance data" });
  }
}

// ───────────────────────────────
// Get summarized stats for an athlete’s performance
export async function getPerformanceSummary(req: Request, res: Response) {
  try {
    const { athleteId } = req.params;

    const metrics = await prisma.performance.findMany({
      where: { athleteId },
      select: { score: true, date: true },
      orderBy: { date: "desc" },
    });

    if (metrics.length === 0)
      return res.json({ success: true, summary: "No performance data available" });

    const averageScore =
      metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length;

    res.json({
      success: true,
      summary: {
        totalSessions: metrics.length,
        averageScore: Number(averageScore.toFixed(2)),
        lastRecorded: metrics[0].date,
      },
    });
  } catch (err) {
    logger.error("Failed to fetch performance summary: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch performance summary" });
  }
                          }
