import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Helper: generate unique athlete code
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// ✅ Get athletes (supports ?userId=, ?limit=, ?page=, ?approved=)
export const getAthletes = async (req: Request, res: Response) => {
  try {
    const { userId, limit, page, approved } = req.query;
    const take = Number(limit) || 10;
    const skip = page ? (Number(page) - 1) * take : 0;

    let whereClause: any = {};

    if (userId) whereClause.userId = String(userId);
    if (approved !== undefined) whereClause.approved = approved === "true";

    const [athletes, total] = await Promise.all([
      prisma.athlete.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          sport: true,
          dob: true,
          gender: true,
          contactInfo: true,
          userId: true,
          approved: true,
          institutionId: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.athlete.count({ where: whereClause }),
    ]);

    res.json({
      success: true,
      data: athletes,
      meta: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    logger.error("Failed to fetch athletes: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athletes" });
  }
};

// ───────────────────────────────
// ✅ Get athlete by ID (includes all related records)
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

    if (!athlete)
      return res.status(404).json({ success: false, message: "Athlete not found" });

    res.json({ success: true, data: athlete });
  } catch (err) {
    logger.error("Error fetching athlete by ID: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete" });
  }
};

// ───────────────────────────────
// ✅ Create athlete (pending approval by default)
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, sport, dob, gender, contactInfo, userId, institutionId } = req.body;

    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required to link athlete" });

    const newAthlete = await prisma.athlete.create({
      data: {
        name,
        sport,
        dob: dob ? new Date(dob) : undefined,
        gender,
        contactInfo,
        athleteCode: generateAthleteCode(),
        user: { connect: { id: userId } },
        approved: false, // must be approved by coach or admin
        institutionId,
      },
    });

    res.status(201).json({
      success: true,
      message: "Athlete created successfully (pending approval).",
      data: newAthlete,
    });
  } catch (err) {
    logger.error("Failed to create athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to create athlete" });
  }
};

// ───────────────────────────────
// ✅ Approve athlete (coach or admin only)
export const approveAthlete = async (req: Request, res: Response) => {
  try {
    const approverId = (req as any).userId;
    const approver = await prisma.user.findUnique({ where: { id: approverId } });

    if (!approver || !["coach", "admin"].includes(approver.role)) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to approve athletes" });
    }

    const { id } = req.params;
    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete)
      return res.status(404).json({ success: false, message: "Athlete not found" });
    if (athlete.approved)
      return res
        .status(400)
        .json({ success: false, message: "Athlete already approved" });

    // Optional: ensure same institution
    if (
      approver.institutionId &&
      athlete.institutionId &&
      approver.institutionId !== athlete.institutionId
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Cannot approve athlete from another institution" });
    }

    const updated = await prisma.athlete.update({
      where: { id },
      data: { approved: true, approvedBy: approverId },
    });

    res.json({
      success: true,
      message: `Athlete ${athlete.name} approved successfully`,
      data: updated,
    });
  } catch (err) {
    logger.error("approveAthlete failed: " + err);
    res.status(500).json({ success: false, message: "Failed to approve athlete" });
  }
};

// ───────────────────────────────
// ✅ Update athlete info
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await prisma.athlete.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("Failed to update athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to update athlete" });
  }
};

// ───────────────────────────────
// ✅ Delete athlete
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
// ✅ Add training session
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
// ✅ Add performance metric
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