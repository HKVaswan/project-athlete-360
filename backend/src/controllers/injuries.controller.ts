import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Get all injury records
export const getInjuries = async (_req: Request, res: Response) => {
  try {
    const injuries = await prisma.injury.findMany({
      include: {
        athlete: { select: { name: true, sport: true, gender: true } },
      },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: injuries });
  } catch (err) {
    logger.error("Error fetching injuries: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch injuries" });
  }
};

// ───────────────────────────────
// Get single injury record
export const getInjuryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const injury = await prisma.injury.findUnique({
      where: { id },
      include: { athlete: { select: { name: true, sport: true } } },
    });
    if (!injury)
      return res.status(404).json({ success: false, message: "Injury record not found" });
    res.json({ success: true, data: injury });
  } catch (err) {
    logger.error("Error fetching injury: " + err);
    res.status(500).json({ success: false, message: "Error fetching injury" });
  }
};

// ───────────────────────────────
// Create new injury record
export const createInjury = async (req: Request, res: Response) => {
  try {
    const { athleteId, description, date, severity } = req.body; // ❌ removed "recoveryNotes"
    const injury = await prisma.injury.create({
      data: { athleteId, description, date, severity },
    });
    res.status(201).json({ success: true, data: injury });
  } catch (err) {
    logger.error("Failed to create injury: " + err);
    res.status(400).json({ success: false, message: "Failed to create injury" });
  }
};

// ───────────────────────────────
// Update injury record
export const updateInjury = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await prisma.injury.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update injury: " + err);
    res.status(400).json({ success: false, message: "Failed to update injury" });
  }
};

// ───────────────────────────────
// Delete injury record
export const deleteInjury = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.injury.delete({ where: { id } });
    res.json({ success: true, message: "Injury record deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete injury: " + err);
    res.status(400).json({ success: false, message: "Failed to delete injury" });
  }
};