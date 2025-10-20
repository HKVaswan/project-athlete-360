import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Get all athletes
export const getAthletes = async (_req: Request, res: Response) => {
  try {
    const athletes = await prisma.athlete.findMany({
      select: { id: true, name: true, sport: true, dob: true, gender: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: athletes });
  } catch (err) {
    logger.error("Failed to fetch athletes: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athletes" });
  }
};

// ───────────────────────────────
// Get athlete by ID
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        sessions: true, // ✅ updated
        performances: true, // ✅ updated
        assessments: true,
        injuries: true,
        attendance: true,
      },
    });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found" });
    res.json({ success: true, data: athlete });
  } catch (err) {
    logger.error("Error fetching athlete: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete" });
  }
};

// ───────────────────────────────
// Create athlete
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, sport, dob, gender, contactInfo } = req.body; // ✅ fixed field names
    const newAthlete = await prisma.athlete.create({
      data: { name, sport, dob, gender, contactInfo },
    });
    res.status(201).json({ success: true, data: newAthlete });
  } catch (err) {
    logger.error("Failed to create athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to create athlete" });
  }
};

// ───────────────────────────────
// Update athlete
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await prisma.athlete.update({ where: { id }, data: req.body });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to update athlete" });
  }
};

// ───────────────────────────────
// Delete athlete
export const deleteAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.athlete.delete({ where: { id } });
    res.json({ success: true, message: "Athlete deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to delete athlete" });
  }
};

// ───────────────────────────────
// Add session to athlete
export const addTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, date, duration, notes } = req.body;
    const session = await prisma.session.create({
      data: {
        name,
        date,
        duration,
        notes,
        athletes: { connect: { id } },
      },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to add session: " + err);
    res.status(400).json({ success: false, message: "Failed to add session" });
  }
};

// ───────────────────────────────
// Add performance record
export const addPerformanceMetric = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assessmentType, score } = req.body;
    const metric = await prisma.performance.create({
      data: {
        athleteId: id,
        assessmentType,
        score: parseFloat(score),
        date: new Date(),
      },
    });
    res.status(201).json({ success: true, data: metric });
  } catch (err) {
    logger.error("Failed to add performance record: " + err);
    res.status(400).json({ success: false, message: "Failed to add performance record" });
  }
};