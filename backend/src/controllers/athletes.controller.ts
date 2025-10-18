// src/controllers/athletes.controller.ts
import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

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

export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        training_sessions: true,
        performance_metrics: true,
      },
    });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found" });
    res.json({ success: true, data: athlete });
  } catch (err) {
    logger.error("Error fetching athlete: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete" });
  }
};

export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, sport, dob, gender, contact_info, athleteId } = req.body;
    const newAthlete = await prisma.athlete.create({
      data: { name, sport, dob, gender, contact_info, athleteId },
    });
    res.status(201).json({ success: true, data: newAthlete });
  } catch (err) {
    logger.error("Failed to create athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to create athlete" });
  }
};

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

export const addTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { session_date, notes } = req.body;
    const session = await prisma.trainingSession.create({
      data: { athleteId: id, session_date, notes },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    logger.error("Failed to add training session: " + err);
    res.status(400).json({ success: false, message: "Failed to add session" });
  }
};

export const addPerformanceMetric = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { metric_name, metric_value, notes } = req.body;
    const metric = await prisma.performanceMetric.create({
      data: { athleteId: id, metric_name, metric_value: parseFloat(metric_value), notes },
    });
    res.status(201).json({ success: true, data: metric });
  } catch (err) {
    logger.error("Failed to add performance metric: " + err);
    res.status(400).json({ success: false, message: "Failed to add metric" });
  }
};
