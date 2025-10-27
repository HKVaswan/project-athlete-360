import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Helper — auto generate competition code (optional visual reference)
const generateCompetitionCode = () =>
  `COMP-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// 🏆 Create a new competition (Admin or Coach)
export const createCompetition = async (req: Request, res: Response) => {
  try {
    const { name, location, startDate, endDate, institutionId } = req.body;

    if (!name || !startDate) {
      return res.status(400).json({
        success: false,
        message: "Competition name and start date are required.",
      });
    }

    const competition = await prisma.competition.create({
      data: {
        name,
        location,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        institutionId,
      },
    });

    res.status(201).json({
      success: true,
      message: "Competition created successfully.",
      data: competition,
    });
  } catch (err) {
    logger.error("❌ createCompetition failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create competition." });
  }
};

// ───────────────────────────────
// 📋 Get all competitions (with optional filters)
export const getCompetitions = async (req: Request, res: Response) => {
  try {
    const { institutionId, upcoming, past, limit, page } = req.query;
    const take = Number(limit) || 10;
    const skip = page ? (Number(page) - 1) * take : 0;

    const whereClause: any = {};

    if (institutionId) whereClause.institutionId = String(institutionId);

    const now = new Date();
    if (upcoming === "true") whereClause.startDate = { gt: now };
    if (past === "true") whereClause.startDate = { lt: now };

    const [competitions, total] = await Promise.all([
      prisma.competition.findMany({
        where: whereClause,
        orderBy: { startDate: "desc" },
        include: {
          institution: { select: { id: true, name: true } },
          participants: {
            include: { athlete: { select: { id: true, name: true, sport: true } } },
          },
        },
        skip,
        take,
      }),
      prisma.competition.count({ where: whereClause }),
    ]);

    res.json({
      success: true,
      data: competitions,
      meta: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    logger.error("❌ getCompetitions failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch competitions." });
  }
};

// ───────────────────────────────
// 🔍 Get competition by ID
export const getCompetitionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const competition = await prisma.competition.findUnique({
      where: { id },
      include: {
        institution: { select: { id: true, name: true } },
        participants: {
          include: {
            athlete: {
              select: {
                id: true,
                name: true,
                sport: true,
                athleteCode: true,
                institutionId: true,
              },
            },
          },
        },
      },
    });

    if (!competition)
      return res
        .status(404)
        .json({ success: false, message: "Competition not found." });

    res.json({ success: true, data: competition });
  } catch (err) {
    logger.error("❌ getCompetitionById failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch competition details." });
  }
};

// ───────────────────────────────
// 🧍 Add athlete to competition (coach/admin only)
export const addAthleteToCompetition = async (req: Request, res: Response) => {
  try {
    const { athleteId, competitionId } = req.body;

    if (!athleteId || !competitionId) {
      return res.status(400).json({
        success: false,
        message: "athleteId and competitionId are required.",
      });
    }

    const participation = await prisma.athleteCompetition.upsert({
      where: { athleteId_competitionId: { athleteId, competitionId } },
      update: {},
      create: { athleteId, competitionId },
    });

    res.status(201).json({
      success: true,
      message: "Athlete added to competition successfully.",
      data: participation,
    });
  } catch (err) {
    logger.error("❌ addAthleteToCompetition failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to add athlete to competition." });
  }
};

// ───────────────────────────────
// 🥇 Update athlete result for a competition
export const updateCompetitionResult = async (req: Request, res: Response) => {
  try {
    const { athleteId, competitionId, result, position, performanceNotes } =
      req.body;

    if (!athleteId || !competitionId) {
      return res.status(400).json({
        success: false,
        message: "athleteId and competitionId are required.",
      });
    }

    const updated = await prisma.athleteCompetition.update({
      where: { athleteId_competitionId: { athleteId, competitionId } },
      data: { result, position, performanceNotes },
    });

    res.json({
      success: true,
      message: "Competition result updated successfully.",
      data: updated,
    });
  } catch (err) {
    logger.error("❌ updateCompetitionResult failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update competition result." });
  }
};

// ───────────────────────────────
// ❌ Delete competition (admin only)
export const deleteCompetition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.competition.delete({ where: { id } });

    res.json({ success: true, message: "Competition deleted successfully." });
  } catch (err) {
    logger.error("❌ deleteCompetition failed: " + err);
    res
      .status(400)
      .json({ success: false, message: "Failed to delete competition." });
  }
};

// ───────────────────────────────
// 🏃 Get all competitions an athlete participated in
export const getAthleteCompetitions = async (req: Request, res: Response) => {
  try {
    const { athleteId } = req.params;

    const competitions = await prisma.athleteCompetition.findMany({
      where: { athleteId },
      include: {
        competition: {
          select: { id: true, name: true, location: true, startDate: true, endDate: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: competitions });
  } catch (err) {
    logger.error("❌ getAthleteCompetitions failed: " + err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch athlete competitions." });
  }
};