// src/controllers/sessions.controller.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// ───────────────────────────────
// Get all sessions
export async function getSessions(_req: Request, res: Response) {
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
    res.status(500).json({ message: "Failed to fetch sessions" });
  }
}

// ───────────────────────────────
// Get session by ID
export async function getSessionById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        attendance: true,
        assessments: true,
      },
    });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (err) {
    logger.error("Error fetching session: " + err);
    res.status(500).json({ message: "Error fetching session" });
  }
}

// ───────────────────────────────
// Create session
export async function createSession(req: Request, res: Response) {
  try {
    const { name, coachId, date, duration, notes, location } = req.body;
    const session = await prisma.session.create({
      data: { name, coachId, date, duration, notes, location },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to create session: " + err);
    res.status(400).json({ message: "Failed to create session" });
  }
}

// ───────────────────────────────
// Update session
export async function updateSession(req: Request, res: Response) {
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

// ───────────────────────────────
// Delete session
export async function deleteSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.session.delete({ where: { id } });
    res.json({ success: true, message: "Session deleted" });
  } catch (err) {
    logger.error("Failed to delete session: " + err);
    res.status(400).json({ message: "Failed to delete session" });
  }
}
