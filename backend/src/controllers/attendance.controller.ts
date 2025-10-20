import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Mark attendance
export const markAttendance = async (req: Request, res: Response) => {
  try {
    const { sessionId, athleteId, status } = req.body; // ❌ removed "notes" (not in schema)
    const attendance = await prisma.attendance.create({
      data: { sessionId, athleteId, status },
    });
    res.status(201).json({ success: true, data: attendance });
  } catch (err) {
    logger.error("Failed to mark attendance: " + err);
    res.status(400).json({ success: false, message: "Failed to mark attendance" });
  }
};

// ───────────────────────────────
// Get attendance by session
export const getAttendanceBySession = async (req: Request, res: Response) => {
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
    res.status(500).json({ success: false, message: "Failed to fetch attendance" });
  }
};

// ───────────────────────────────
// Update attendance record
export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await prisma.attendance.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update attendance: " + err);
    res.status(400).json({ success: false, message: "Failed to update attendance" });
  }
};

// ───────────────────────────────
// Delete attendance
export const deleteAttendance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.attendance.delete({ where: { id } });
    res.json({ success: true, message: "Attendance deleted successfully" });
  } catch (err) {
    logger.error("Failed to delete attendance: " + err);
    res.status(400).json({ success: false, message: "Failed to delete attendance" });
  }
};