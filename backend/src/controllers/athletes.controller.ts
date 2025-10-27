// src/controllers/athletes.controller.ts
import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Prisma } from "@prisma/client";

// ───────────────────────────────
// 🧩 Helper: Generate unique athlete code
const generateAthleteCode = (): string => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// ✅ Get all athletes (with filters, pagination & search)
// Example: /api/athletes?institutionId=abc&approved=true&search=raj&page=1&limit=10
// ───────────────────────────────
export const getAthletes = async (req: Request, res: Response) => {
  try {
    const { institutionId, approved, search, limit, page } = req.query;

    const take = Math.min(Number(limit) || 10, 50); // Cap to 50 for performance
    const skip = page ? (Number(page) - 1) * take : 0;

    const where: Prisma.AthleteWhereInput = {
      ...(institutionId ? { institutionId: String(institutionId) } : {}),
      ...(approved !== undefined ? { approved: approved === "true" } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: String(search), mode: "insensitive" } },
              { sport: { contains: String(search), mode: "insensitive" } },
              { athleteCode: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [athletes, total] = await Promise.all([
      prisma.athlete.findMany({
        where,
        include: {
          user: { select: { username: true, email: true, role: true } },
          institution: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.athlete.count({ where }),
    ]);

    return res.json({
      success: true,
      message: "Athletes fetched successfully.",
      data: athletes,
      meta: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err: any) {
    logger.error(`❌ getAthletes failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to fetch athletes." });
  }
};

// ───────────────────────────────
// ✅ Get athlete by ID (deep include: achievements, sessions, etc.)
// ───────────────────────────────
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true, role: true } },
        institution: { select: { id: true, name: true, code: true } },
        sessions: true,
        assessments: true,
        performances: true,
        injuries: true,
        attendance: true,
        competitions: {
          include: {
            competition: { select: { id: true, name: true, startDate: true, location: true } },
          },
        },
      },
    });

    if (!athlete) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }

    return res.json({ success: true, data: athlete });
  } catch (err: any) {
    logger.error(`❌ getAthleteById failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to fetch athlete details." });
  }
};

// ───────────────────────────────
// ✅ Create athlete (pending approval)
// ───────────────────────────────
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { userId, name, sport, dob, gender, contactInfo, institutionId } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ success: false, message: "userId and name are required." });
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
      return res.status(404).json({ success: false, message: "Linked user not found." });
    }

    const existingAthlete = await prisma.athlete.findUnique({ where: { userId } });
    if (existingAthlete) {
      return res.status(400).json({ success: false, message: "Athlete already exists for this user." });
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

    // Future: Notify assigned coach or institution admin
    // e.g., NotificationService.notifyInstitution(institutionId, `${name} has registered as an athlete.`);

    logger.info(`🆕 Athlete created: ${athlete.name} (${athlete.athleteCode})`);

    return res.status(201).json({
      success: true,
      message: "Athlete created successfully (pending approval).",
      data: athlete,
    });
  } catch (err: any) {
    logger.error(`❌ createAthlete failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to create athlete." });
  }
};

// ───────────────────────────────
// ✅ Approve athlete (coach/admin only)
// ───────────────────────────────
export const approveAthlete = async (req: Request, res: Response) => {
  try {
    const approverId = (req as any).userId;
    const { id } = req.params;

    const approver = await prisma.user.findUnique({ where: { id: approverId } });
    if (!approver || !["coach", "admin"].includes(approver.role)) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) {
      return res.status(404).json({ success: false, message: "Athlete not found." });
    }
    if (athlete.approved) {
      return res.status(400).json({ success: false, message: "Athlete already approved." });
    }

    const updated = await prisma.athlete.update({
      where: { id },
      data: { approved: true, approvedBy: approverId, approvedAt: new Date() },
    });

    logger.info(`✅ Athlete approved: ${updated.name} by ${approver.username}`);

    return res.json({
      success: true,
      message: `Athlete ${updated.name} approved successfully.`,
      data: updated,
    });
  } catch (err: any) {
    logger.error(`❌ approveAthlete failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to approve athlete." });
  }
};

// ───────────────────────────────
// ✅ Update athlete (basic info update)
// ───────────────────────────────
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found." });

    const updated = await prisma.athlete.update({
      where: { id },
      data: req.body,
    });

    logger.info(`✏️ Athlete updated: ${updated.name}`);
    return res.json({ success: true, message: "Athlete updated successfully.", data: updated });
  } catch (err: any) {
    logger.error(`❌ updateAthlete failed: ${err.message || err}`);
    res.status(400).json({ success: false, message: "Failed to update athlete." });
  }
};

// ───────────────────────────────
// ✅ Delete athlete (admin or institution-level)
// ───────────────────────────────
export const deleteAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const athlete = await prisma.athlete.findUnique({ where: { id } });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found." });

    await prisma.$transaction([
      prisma.performance.deleteMany({ where: { athleteId: id } }),
      prisma.session.deleteMany({ where: { athletes: { some: { id } } } }),
      prisma.athlete.delete({ where: { id } }),
    ]);

    logger.warn(`🗑️ Athlete deleted: ${athlete.name}`);
    return res.json({ success: true, message: "Athlete deleted successfully." });
  } catch (err: any) {
    logger.error(`❌ deleteAthlete failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to delete athlete." });
  }
};

// ───────────────────────────────
// ✅ Add training session for athlete
// ───────────────────────────────
export const addTrainingSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, date, duration, notes } = req.body;

    const session = await prisma.session.create({
      data: {
        name,
        date: new Date(date),
        duration,
        notes,
        athletes: { connect: { id } },
      },
    });

    logger.info(`🧠 Training session added for athlete ${id}`);
    return res.status(201).json({
      success: true,
      message: "Session added successfully.",
      data: session,
    });
  } catch (err: any) {
    logger.error(`❌ addTrainingSession failed: ${err.message || err}`);
    res.status(400).json({ success: false, message: "Failed to add session." });
  }
};

// ───────────────────────────────
// ✅ Add performance metric
// ───────────────────────────────
export const addPerformanceMetric = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assessmentType, score, notes } = req.body;

    const metric = await prisma.performance.create({
      data: {
        athleteId: id,
        assessmentType,
        score: parseFloat(score),
        notes,
        date: new Date(),
      },
    });

    logger.info(`📈 Performance metric added for athlete ${id}`);
    return res.status(201).json({
      success: true,
      message: "Performance metric recorded successfully.",
      data: metric,
    });
  } catch (err: any) {
    logger.error(`❌ addPerformanceMetric failed: ${err.message || err}`);
    res.status(400).json({ success: false, message: "Failed to add performance record." });
  }
};

// ───────────────────────────────
// 🏆 Record competition participation
// ───────────────────────────────
export const recordCompetitionResult = async (req: Request, res: Response) => {
  try {
    const { athleteId, competitionId, result, position, performanceNotes } = req.body;

    const participation = await prisma.athleteCompetition.upsert({
      where: { athleteId_competitionId: { athleteId, competitionId } },
      update: { result, position, performanceNotes },
      create: { athleteId, competitionId, result, position, performanceNotes },
    });

    logger.info(`🏅 Competition result recorded for athlete ${athleteId}`);
    return res.status(201).json({
      success: true,
      message: "Competition result recorded successfully.",
      data: participation,
    });
  } catch (err: any) {
    logger.error(`❌ recordCompetitionResult failed: ${err.message || err}`);
    res.status(500).json({ success: false, message: "Failed to record competition result." });
  }
};