// src/controllers/trainingSessions.controller.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// ───────────────────────────────
// Get all training sessions
export async function getTrainingSessions(_req: Request, res: Response) {
  try {
    const sessions = await prisma.trainingSession.findMany({
      include: {
        coach: { select: { name: true, email: true } },
        athletes: { select: { id: true, name: true, sport: true } },
        feedbacks: true,
      },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: sessions });
  } catch (err) {
    logger.error("Failed to fetch training sessions: " + err);
    res.status(500).json({ message: "Failed to fetch training sessions" });
  }
}

// ───────────────────────────────
// Get specific training session
export async function getTrainingSessionById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const session = await prisma.trainingSession.findUnique({
      where: { id },
      include: {
        coach: true,
        athletes: true,
        feedbacks: true,
      },
    });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    logger.error("Error fetching training session: " + err);
    res.status(500).json({ message: "Error fetching training session" });
  }
}

// ───────────────────────────────
// Create new training session
export async function createTrainingSession(req: Request, res: Response) {
  try {
    const { name, coachId, date, duration, notes } = req.body;
    const session = await prisma.trainingSession.create({
      data: { name, coachId, date, duration, notes },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to create training session: " + err);
    res.status(400).json({ message: "Failed to create training session" });
  }
}

// ───────────────────────────────
// Update training session
export async function updateTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updated = await prisma.trainingSession.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update training session: " + err);
    res.status(400).json({ message: "Failed to update training session" });
  }
}

// ───────────────────────────────
// Delete training session
export async function deleteTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.trainingSession.delete({ where: { id } });
    res.json({ success: true, message: "Training session deleted" });
  } catch (err) {
    logger.error("Failed to delete training session: " + err);
    res.status(400).json({ message: "Failed to delete training session" });
  }
}

// ───────────────────────────────
// Add athlete to training session
export async function addAthleteToTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { athleteId } = req.body;
    const updated = await prisma.trainingSession.update({
      where: { id },
      data: {
        athletes: { connect: { id: athleteId } },
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to add athlete to training session: " + err);
    res.status(400).json({ message: "Failed to add athlete" });
  }
}

// ───────────────────────────────
// Add coach feedback to training session
export async function addFeedbackToTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { coachId, notes, rating } = req.body;
    const feedback = await prisma.trainingFeedback.create({
      data: {
        trainingSessionId: id,
        coachId,
        notes,
        rating,
      },
    });
    res.status(201).json({ success: true, data: feedback });
  } catch (err) {
    logger.error("Failed to add feedback: " + err);
    res.status(400).json({ message: "Failed to add feedback" });
  }
}
