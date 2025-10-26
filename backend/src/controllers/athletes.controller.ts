import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Helper: generate unique athlete code
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// ✅ Get athletes (supports ?userId=)
export const getAthletes = async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (userId) {
      const athlete = await prisma.athlete.findMany({
        where: { userId: String(userId) },
        select: {
          id: true,
          name: true,
          sport: true,
          dob: true,
          gender: true,
          contactInfo: true,
          userId: true,
        },
      });

      if (!athlete || athlete.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No athlete found for this user.",
        });
      }

      return res.json({ success: true, data: athlete });
    }

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
// ✅ Get athlete by ID (used in /api/athletes/:id)
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        sessions: true,
        performances: true,
        assessments: true,
        injuries: true,
        attendance: true,
      },
    });

    if (!athlete) {
      return res.status(404).json({ success: false, message: "Athlete not found" });
    }

    res.json({ success: true, data: athlete });
  } catch (err) {
    logger.error("Error fetching athlete by ID: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete" });
  }
};

// ───────────────────────────────
// Create athlete
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, sport, dob, gender, contactInfo, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required to link athlete" });
    }

    // If an athlete already exists for this user, return it (idempotent)
    const existing = await prisma.athlete.findUnique({ where: { userId: String(userId) } });
    if (existing) {
      return res.status(200).json({ success: true, message: "Athlete already exists for this user", data: existing });
    }

    const newAthlete = await prisma.athlete.create({
      data: {
        name,
        sport,
        dob: dob ? new Date(dob) : undefined,
        gender,
        contactInfo,
        athleteCode: generateAthleteCode(),
        user: { connect: { id: userId } }, // mandatory relation
      },
    });

    res.status(201).json({ success: true, data: newAthlete });
  } catch (err: any) {
    logger.error("Failed to create athlete: " + err);
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate athlete or unique constraint violation" });
    }
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