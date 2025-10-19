// src/controllers/attendance.controller.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";

const prisma = new PrismaClient();

// ───────────────────────────────
// Mark attendance
export async function markAttendance(req: Request, res: Response) {
  try {
    const { sessionId, athleteId, status, notes } = req.body;
    const attendance = await prisma.attendance.create({
      data: { sessionId, athleteId, status, notes },
    });
    res.status(201).json({ success: true, data: attendance });
  } catch (err) {
    logger.error("Failed to mark attendance: " + err);
    res.status(400).json({ message: "Failed to mark attendance" });
  }
}

// ───────────────────────────────
// Get attendance by session
export async function getAttendanceBySession(req: Request, res: Response) {
  try {
    const { sessionId } = req.params;
    const attendance = await prisma.attendance.findMany({
      where: { sessionId },
      include: {
        athlete: { select: { name: true, sport: true } },
        session: { select: { name: true, date: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: attendance });
  } catch (err) {
    logger.error("Failed to fetch attendance: " + err);
    res.status(500).json({ message: "Failed to fetch attendance" });
  }
}

// ───────────────────────────────
// Update attendance record
export async function updateAttendance(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updated = await prisma.attendance.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update attendance: " + err);
    res.status(400).json({ message: "Failed to update attendance" });
  }
}

// ───────────────────────────────
// Delete attendance
export async function deleteAttendance(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.attendance.delete({ where: { id } });
    res.json({ success: true, message: "Attendance deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete attendance: " + err);
    res.status(400).json({ message: "Failed to delete attendance" });
  }
}
