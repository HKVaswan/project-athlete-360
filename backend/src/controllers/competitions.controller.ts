// src/controllers/competitions.controller.ts
import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// Helper — auto generate competition code
const generateCompetitionCode = () =>
  `COMP-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// 🏆 Create a new competition (Admin or Coach)
// ───────────────────────────────
export const createCompetition = async (req: Request, res: Response) => {
  try {
    const { name, location, startDate, endDate, institutionId } = req.body;
    const role = (req as any).role;

    if (!["admin", "coach"].includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Only admin or coach can create competitions.",
      });
    }

    if (!name || !startDate) {
      return res
        .status(400)
        .json({ success: false, message: "Name and startDate are required." });
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

    logger.info(`🏆 Competition created: ${competition.name}`);
    res.status(201).json({
      success: true,
      message: "Competition created successfully.",
      data: competition,
    });
  } catch (err: any) {
    logger.error("❌ createCompetition failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to create competition." });
  }
};

// ───────────────────────────────
// 📋 Get all competitions (with filters, pagination, and status calculation)
// ───────────────────────────────
export const getCompetitions = async (req: Request, res: Response) => {
  try {
    const { institutionId, status, search, page, limit } = req.query;
    const take = Math.min(Number(limit) || 10, 50);
    const skip = page ? (Number(page) - 1) * take : 0;

    const where: any = {};
    if (institutionId) where.institutionId = String(institutionId);
    if (search) where.name = { contains: String(search), mode: "insensitive" };

    // Filter by competition status dynamically
    const now = new Date();
    if (status === "upcoming") where.startDate = { gt: now };
    else if (status === "completed") where.endDate = { lt: now };
    else if (status === "ongoing") where.AND = [
      { startDate: { lte: now } },
      { OR: [{ endDate: null }, { endDate: { gte: now } }] },
    ];

    const [competitions, total] = await Promise.all([
      prisma.competition.findMany({
        where,
        include: {
          institution: { select: { id: true, name: true, code: true } },
          participants: {
            include: {
              athlete: {
                select: { id: true, name: true, sport: true, athleteCode: true },
              },
            },
          },
        },
        orderBy: { startDate: "desc" },
        skip,
        take,
      }),
      prisma.competition.count({ where }),
    ]);

    // Enrich with derived fields (like winner or status)
    const enriched = competitions.map((c) => {
      const now = new Date();
      const status =
        c.startDate > now
          ? "upcoming"
          : c.endDate && c.endDate < now
          ? "completed"
          : "ongoing";

      const winner = c.participants.find((p) => p.position === 1);
      return { ...c, status, winner: winner ? winner.athlete : null };
    });

    res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err: any) {
    logger.error("❌ getCompetitions failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to fetch competitions." });
  }
};

// ───────────────────────────────
// 🔍 Get competition by ID (with full participation and stats)
// ───────────────────────────────
export const getCompetitionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const competition = await prisma.competition.findUnique({
      where: { id },
      include: {
        institution: { select: { id: true, name: true, code: true } },
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

    const stats = {
      totalParticipants: competition.participants.length,
      awardedPositions: competition.participants.filter((p) => p.position).length,
      winner:
        competition.participants.find((p) => p.position === 1)?.athlete?.name ||
        null,
    };

    res.json({ success: true, data: { ...competition, stats } });
  } catch (err: any) {
    logger.error("❌ getCompetitionById failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to fetch competition details." });
  }
};

// ───────────────────────────────
// 🧍 Add single or multiple athletes to a competition
// ───────────────────────────────
export const addAthleteToCompetition = async (req: Request, res: Response) => {
  try {
    const { athleteIds, competitionId } = req.body;
    const role = (req as any).role;

    if (!["admin", "coach"].includes(role))
      return res.status(403).json({ success: false, message: "Unauthorized" });

    if (!competitionId || !athleteIds?.length)
      return res
        .status(400)
        .json({ success: false, message: "competitionId and athleteIds are required." });

    const results = await prisma.$transaction(
      athleteIds.map((athleteId: string) =>
        prisma.athleteCompetition.upsert({
          where: { athleteId_competitionId: { athleteId, competitionId } },
          update: {},
          create: { athleteId, competitionId },
        })
      )
    );

    logger.info(`🏃 Added ${results.length} athlete(s) to competition ${competitionId}`);
    res.status(201).json({
      success: true,
      message: `${results.length} athlete(s) added successfully.`,
      data: results,
    });
  } catch (err: any) {
    logger.error("❌ addAthleteToCompetition failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to add athletes." });
  }
};

// ───────────────────────────────
// 🥇 Update athlete result for competition
// ───────────────────────────────
export const updateCompetitionResult = async (req: Request, res: Response) => {
  try {
    const { athleteId, competitionId, result, position, performanceNotes } = req.body;
    const role = (req as any).role;

    if (!["coach", "admin"].includes(role))
      return res.status(403).json({ success: false, message: "Unauthorized" });

    const updated = await prisma.athleteCompetition.update({
      where: { athleteId_competitionId: { athleteId, competitionId } },
      data: { result, position, performanceNotes },
    });

    res.json({
      success: true,
      message: "Competition result updated successfully.",
      data: updated,
    });
  } catch (err: any) {
    logger.error("❌ updateCompetitionResult failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to update competition result." });
  }
};

// ───────────────────────────────
// ❌ Delete competition (admin only)
// ───────────────────────────────
export const deleteCompetition = async (req: Request, res: Response) => {
  try {
    const role = (req as any).role;
    const { id } = req.params;

    if (role !== "admin")
      return res.status(403).json({ success: false, message: "Only admins can delete competitions." });

    await prisma.competition.delete({ where: { id } });
    logger.info(`🗑️ Competition ${id} deleted`);

    res.json({ success: true, message: "Competition deleted successfully." });
  } catch (err: any) {
    logger.error("❌ deleteCompetition failed: " + err.message || err);
    res.status(400).json({ success: false, message: "Failed to delete competition." });
  }
};

// ───────────────────────────────
// 🏃 Get all competitions an athlete participated in
// ───────────────────────────────
export const getAthleteCompetitions = async (req: Request, res: Response) => {
  try {
    const { athleteId } = req.params;

    const competitions = await prisma.athleteCompetition.findMany({
      where: { athleteId },
      include: {
        competition: {
          select: {
            id: true,
            name: true,
            location: true,
            startDate: true,
            endDate: true,
            institutionId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: competitions });
  } catch (err: any) {
    logger.error("❌ getAthleteCompetitions failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete competitions." });
  }
};