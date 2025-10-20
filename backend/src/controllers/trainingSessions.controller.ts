import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// Get all sessions
export async function getTrainingSessions(_req: Request, res: Response) {
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
    res.status(500).json({ message: "Failed to fetch training sessions" });
  }
}

// Get specific session
export async function getTrainingSessionById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: { athletes: true },
    });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    logger.error("Error fetching training session: " + err);
    res.status(500).json({ message: "Error fetching training session" });
  }
}

// Create session
export async function createTrainingSession(req: Request, res: Response) {
  try {
    const { name, coachId, date, duration, notes } = req.body;
    const session = await prisma.session.create({
      data: { name, coachId, date, duration, notes },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to create session: " + err);
    res.status(400).json({ message: "Failed to create session" });
  }
}

// Update session
export async function updateTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updated = await prisma.session.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update session: " + err);
    res.status(400).json({ message: "Failed to update session" });
  }
}

// Delete session
export async function deleteTrainingSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.session.delete({ where: { id } });
    res.json({ success: true, message: "Session deleted" });
  } catch (err) {
    logger.error("Failed to delete session: " + err);
    res.status(400).json({ message: "Failed to delete session" });
  }
}

// Add athlete to session
export async function addAthleteToTrainingSession(req: Request, res: Response) {
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
    res.status(400).json({ message: "Failed to add athlete" });
  }
}
