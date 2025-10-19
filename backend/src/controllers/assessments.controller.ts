// src/controllers/assessments.controller.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// ───────────────────────────────
// Get all or filtered assessments
export async function getAssessments(req: Request, res: Response) {
  try {
    const { athleteId, sessionId, metric } = req.query;
    const filters: any = {};

    if (athleteId) filters.athleteId = String(athleteId);
    if (sessionId) filters.sessionId = String(sessionId);
    if (metric) filters.metric = String(metric);

    const assessments = await prisma.assessment.findMany({
      where: filters,
      orderBy: { createdAt: "desc" },
      include: {
        athlete: { select: { name: true, sport: true } },
        session: { select: { name: true, date: true } },
      },
    });

    res.json({ success: true, data: assessments });
  } catch (err) {
    logger.error("Failed to fetch assessments: " + err);
    res.status(500).json({ message: "Error fetching assessments" });
  }
}

// ───────────────────────────────
// Create new assessment
export async function createAssessment(req: Request, res: Response) {
  try {
    const { athleteId, sessionId, metric, valueNumber, valueText, notes } = req.body;

    const assessment = await prisma.assessment.create({
      data: { athleteId, sessionId, metric, valueNumber, valueText, notes },
    });

    res.status(201).json({ success: true, data: assessment });
  } catch (err) {
    logger.error("Failed to create assessment: " + err);
    res.status(400).json({ message: "Failed to create assessment" });
  }
}

// ───────────────────────────────
// Update assessment
export async function updateAssessment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updated = await prisma.assessment.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update assessment: " + err);
    res.status(400).json({ message: "Failed to update assessment" });
  }
}

// ───────────────────────────────
// Delete assessment
export async function deleteAssessment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.assessment.delete({ where: { id } });
    res.json({ success: true, message: "Assessment deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete assessment: " + err);
    res.status(400).json({ message: "Failed to delete assessment" });
  }
}
