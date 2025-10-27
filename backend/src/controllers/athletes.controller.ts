import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Helper: generate unique athlete code
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// ✅ Get athletes (supports ?institutionId=, ?approved=, ?limit=, ?page=)
export const getAthletes = async (req: Request, res: Response) => {
  try {
    const { institutionId, approved, limit, page } = req.query;
    const take = Number(limit) || 10;
    const skip = page ? (Number(page) - 1) * take : 0;

    const whereClause: any = {};
    if (institutionId) whereClause.institutionId = String(institutionId);
    if (approved !== undefined) whereClause.approved = approved === "true";

    const [athletes, total] = await Promise.all([
      prisma.athlete.findMany({
        where: whereClause,
        include: {
          user: { select: { username: true, email: true } },
          institution: { select: { name: true, code: true } },
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
    logger.error("❌ Failed to fetch athletes: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athletes" });
  }
};

// ───────────────────────────────
// ✅ Get athlete by ID (includes achievements, sessions, injuries)
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
        institution: { select: { id: true, name: true, code: true } },
        sessions: true,
        assessments: true,
        performances: true,
        injuries: true,
        attendance: true,
        competitions: {
          include: { competition: { select: { name: true, startDate: true, location: true } } },
        },
      },
    });

    if (!athlete) {
      return res.status(404).json({ success: false, message: "Athlete not found" });
    }

    res.json({ success: true, data: athlete });
  } catch (err) {
    logger.error("❌ Error fetching athlete by ID: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete details" });
  }
};

// ───────────────────────────────
// ✅ Create athlete (pending approval, linked to institution)
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { userId, name, sport, dob, gender, contactInfo, institutionId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const athlete = await prisma.athlete.create({
      data: {
        user: { connect: { id: userId } },
        athleteCode: generateAthleteCode(),
        name,
        sport,
        dob: dob ? new Date(dob) : undefined,
        gender,
        contactInfo,
        institution: institutionId ? { connect: { id: institutionId } } : undefined,
        approved: false,
      },
    });

    res.status(201).json({
      success: true,
      message: "Athlete registered successfully. Awaiting approval.",
      data: athlete,
    });
  } catch (err) {
    logger.error("❌ Failed to create athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to create athlete" });
  }
};

// ───────────────────────────────
// ✅ Approve athlete (coach/admin)
export const approveAthlete = async (req: Request, res: Response) => {
  try {
    const approverId = (req as any).userId;
    const { id } = req.params;

    const approver = await prisma.user.findUnique({ where: { id: approverId } });
    if (!approver || !["coach", "admin"].includes(approver.role)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found" });
    if (athlete.approved)
      return res.status(400).json({ success: false, message: "Athlete already approved" });

    const updated = await prisma.athlete.update({
      where: { id },
      data: { approved: true, approvedBy: approverId },
    });

    res.json({
      success: true,
      message: `${athlete.name} approved successfully.`,
      data: updated,
    });
  } catch (err) {
    logger.error("❌ approveAthlete failed: " + err);
    res.status(500).json({ success: false, message: "Failed to approve athlete" });
  }
};

// ───────────────────────────────
// ✅ Update athlete
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = await prisma.athlete.update({
      where: { id },
      data: req.body,
    });

    res.json({
      success: true,
      message: "Athlete updated successfully",
      data: updated,
    });
  } catch (err) {
    logger.error("❌ Failed to update athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to update athlete" });
  }
};

// ───────────────────────────────
// ✅ Delete athlete (admin or institution only)
export const deleteAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.athlete.delete({ where: { id } });

    res.json({ success: true, message: "Athlete deleted successfully" });
  } catch (err) {
    logger.error("❌ Failed to delete athlete: " + err);
    res.status(400).json({ success: false, message: "Failed to delete athlete" });
  }
};

// ───────────────────────────────
// ✅ Add training session for athlete
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

    res.status(201).json({
      success: true,
      message: "Session added successfully",
      data: session,
    });
  } catch (err) {
    logger.error("❌ Failed to add session: " + err);
    res.status(400).json({ success: false, message: "Failed to add session" });
  }
};

// ───────────────────────────────
// ✅ Add performance metric (coach or system)
export const addPerformanceMetric = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assessmentType, score, notes } = req.body;

    const metric = await prisma.performance.create({
      data: {
        athleteId: id,
        assessmentType,
        score: parseFloat(score),
        date: new Date(),
      },
    });

    res.status(201).json({
      success: true,
      message: "Performance metric added",
      data: metric,
    });
  } catch (err) {
    logger.error("❌ Failed to add performance record: " + err);
    res.status(400).json({ success: false, message: "Failed to add performance record" });
  }
};

// ───────────────────────────────
// 🏆 Record competition participation
export const recordCompetitionResult = async (req: Request, res: Response) => {
  try {
    const { athleteId, competitionId, result, position, performanceNotes } = req.body;

    const participation = await prisma.athleteCompetition.upsert({
      where: { athleteId_competitionId: { athleteId, competitionId } },
      update: { result, position, performanceNotes },
      create: { athleteId, competitionId, result, position, performanceNotes },
    });

    res.status(201).json({
      success: true,
      message: "Competition result recorded successfully",
      data: participation,
    });
  } catch (err) {
    logger.error("❌ Failed to record competition result: " + err);
    res.status(500).json({ success: false, message: "Failed to record competition result" });
  }
};