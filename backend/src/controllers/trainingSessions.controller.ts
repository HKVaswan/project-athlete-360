// src/controllers/trainingSessions.controller.ts
import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Get all sessions
export const getTrainingSessions = async (_req: Request, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      include: {
        athletes: { select: { id: true, name: true, sport: true } },
      },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: sessions });
  } catch (err) {
    logger.error("Failed to fetch training sessions: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch training sessions" });
  }
};

// ───────────────────────────────
// Get specific session
export const getTrainingSessionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        athletes: { select: { id: true, name: true, sport: true } },
        attendance: true,
        assessments: true,
      },
    });
    if (!session) return res.status(404).json({ success: false, message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    logger.error("Error fetching training session: " + err);
    res.status(500).json({ success: false, message: "Error fetching training session" });
  }
};

// ───────────────────────────────
// Create session
export const createTrainingSession = async (req: Request, res: Response) => {
  try {
    const { name, coachId, date, duration, notes } = req.body;
    const session = await prisma.session.create({
      data: { name, coachId, date, duration, notes },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to create session: " + err);
    res.status(400).json({ success: false, message: "Failed to create session" });
  }
};

// ───────────────────────────────
// Update session
export const updateTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await prisma.session.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update session: " + err);
    res.status(400).json({ success: false, message: "Failed to update session" });
  }
};

// ───────────────────────────────
// Delete session
export const deleteTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.session.delete({ where: { id } });
    res.json({ success: true, message: "Session deleted" });
  } catch (err) {
    logger.error("Failed to delete session: " + err);
    res.status(400).json({ success: false, message: "Failed to delete session" });
  }
};

// ───────────────────────────────
// Add athlete to session
export const addAthleteToTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { athleteId } = req.body;

    const updated = await prisma.session.update({
      where: { id },
      data: {
        athletes: { connect: { id: athleteId } },
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to add athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to add athlete" });
  }
};