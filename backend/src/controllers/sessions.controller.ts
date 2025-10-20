import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Get all sessions
export const getSessions = async (_req: Request, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { date: "desc" },
      include: {
        attendance: true,
        assessments: true,
      },
    });
    res.json({ success: true, data: sessions });
  } catch (err) {
    logger.error("Failed to fetch sessions: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch sessions" });
  }
};

// ───────────────────────────────
// Get session by ID
export const getSessionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        attendance: true,
        assessments: true,
      },
    });
    if (!session)
      return res.status(404).json({ success: false, message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    logger.error("Error fetching session: " + err);
    res.status(500).json({ success: false, message: "Error fetching session" });
  }
};

// ───────────────────────────────
// Create session
export const createSession = async (req: Request, res: Response) => {
  try {
    const { name, coachId, date, duration, notes, institutionId } = req.body; // ✅ removed 'location'
    const session = await prisma.session.create({
      data: { name, coachId, date, duration, notes, institutionId },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to create session: " + err);
    res.status(400).json({ success: false, message: "Failed to create session" });
  }
};

// ───────────────────────────────
// Update session
export const updateSession = async (req: Request, res: Response) => {
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
export const deleteSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.session.delete({ where: { id } });
    res.json({ success: true, message: "Session deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete session: " + err);
    res.status(400).json({ success: false, message: "Failed to delete session" });
  }
};