// src/services/competition.service.ts
/**
 * Competition Service
 * ------------------------------------------------------------
 * Handles:
 *  - Competition creation & management
 *  - Athlete participation
 *  - Result updates & leaderboard management
 *  - Advanced filtering (upcoming, ongoing, completed)
 *  - Admin & institution-level scoping
 *  - Data consistency + transaction safety
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate, computeNextCursor } from "../utils/pagination";

/**
 * Generate unique competition code.
 * Example: COMP-2025-1234
 */
const generateCompetitionCode = () => {
  const random = Math.floor(1000 + Math.random() * 9000);
  const year = new Date().getFullYear();
  return `COMP-${year}-${random}`;
};

/**
 * Create a new competition
 * Admin or Coach (with permission) can create competitions
 */
export const createCompetition = async (data: {
  name: string;
  location?: string;
  startDate: Date;
  endDate?: Date | null;
  institutionId: string;
  createdById: string;
}) => {
  const { name, location, startDate, endDate, institutionId, createdById } = data;

  // Check institution
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  // Validate name uniqueness for institution
  const existing = await prisma.competition.findFirst({
    where: { name, institutionId },
  });
  if (existing) throw Errors.Duplicate("Competition with this name already exists in institution");

  const code = generateCompetitionCode();

  const competition = await prisma.competition.create({
    data: {
      name,
      location,
      startDate,
      endDate,
      code,
      institutionId,
      createdById,
    },
  });

  logger.info(`Competition created: ${competition.name} (${competition.code})`);
  return competition;
};

/**
 * Fetch competitions with optional filters (upcoming, past, search, pagination)
 */
export const getCompetitions = async (query: any, institutionId?: string) => {
  const where: any = {};
  const now = new Date();

  if (institutionId) where.institutionId = institutionId;
  if (query.upcoming === "true") where.startDate = { gt: now };
  if (query.past === "true") where.startDate = { lt: now };
  if (query.search) {
    const s = String(query.search).trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { location: { contains: s, mode: "insensitive" } },
    ];
  }

  const { prismaArgs, meta } = await paginate(query, "offset", {
    where,
    countFn: (w) => prisma.competition.count({ where: w }),
    includeTotal: true,
  });

  const competitions = await prisma.competition.findMany({
    ...prismaArgs,
    where,
    include: {
      institution: { select: { id: true, name: true } },
      participants: {
        include: { athlete: { select: { id: true, sport: true, user: { select: { name: true } } } } },
      },
    },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(competitions);

  return { data: competitions, meta };
};

/**
 * Get competition by ID (with participants)
 */
export const getCompetitionById = async (competitionId: string) => {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: {
      institution: { select: { id: true, name: true } },
      participants: {
        include: {
          athlete: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  if (!competition) throw Errors.NotFound("Competition not found");
  return competition;
};

/**
 * Add athlete to competition
 * Ensures no duplicate entries
 */
export const addAthleteToCompetition = async (athleteId: string, competitionId: string) => {
  const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });

  if (!athlete) throw Errors.NotFound("Athlete not found");
  if (!competition) throw Errors.NotFound("Competition not found");

  // Prevent duplicate registration
  const existing = await prisma.athleteCompetition.findUnique({
    where: { athleteId_competitionId: { athleteId, competitionId } },
  });
  if (existing) throw Errors.Duplicate("Athlete already registered in this competition");

  const participation = await prisma.athleteCompetition.create({
    data: { athleteId, competitionId },
  });

  logger.info(`Athlete ${athleteId} added to competition ${competitionId}`);
  return participation;
};

/**
 * Update athlete performance / result
 */
export const updateAthleteResult = async (data: {
  athleteId: string;
  competitionId: string;
  result?: string;
  position?: number;
  performanceNotes?: string;
}) => {
  const { athleteId, competitionId, result, position, performanceNotes } = data;

  const record = await prisma.athleteCompetition.findUnique({
    where: { athleteId_competitionId: { athleteId, competitionId } },
  });
  if (!record) throw Errors.NotFound("Athlete not registered in this competition");

  const updated = await prisma.athleteCompetition.update({
    where: { athleteId_competitionId: { athleteId, competitionId } },
    data: { result, position, performanceNotes },
  });

  logger.info(`Updated result for athlete ${athleteId} in competition ${competitionId}`);
  return updated;
};

/**
 * Get athlete’s competition history
 */
export const getAthleteCompetitions = async (athleteId: string) => {
  const records = await prisma.athleteCompetition.findMany({
    where: { athleteId },
    include: {
      competition: {
        select: { id: true, name: true, location: true, startDate: true, endDate: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return records.map((r) => ({
    competitionId: r.competition.id,
    competitionName: r.competition.name,
    location: r.competition.location,
    startDate: r.competition.startDate,
    endDate: r.competition.endDate,
    result: r.result,
    position: r.position,
  }));
};

/**
 * Delete competition (Admin only)
 * Transaction-safe to clean up linked records
 */
export const deleteCompetition = async (competitionId: string) => {
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });
  if (!competition) throw Errors.NotFound("Competition not found");

  await prisma.$transaction(async (tx) => {
    await tx.athleteCompetition.deleteMany({ where: { competitionId } });
    await tx.competition.delete({ where: { id: competitionId } });
  });

  logger.warn(`Competition deleted: ${competition.name}`);
  return { success: true };
};

/**
 * Compute Leaderboard
 * Returns athletes sorted by position (lowest first)
 */
export const getCompetitionLeaderboard = async (competitionId: string) => {
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });
  if (!competition) throw Errors.NotFound("Competition not found");

  const leaderboard = await prisma.athleteCompetition.findMany({
    where: { competitionId },
    include: {
      athlete: { include: { user: { select: { name: true } } } },
    },
    orderBy: [{ position: "asc" }],
  });

  return leaderboard.map((entry) => ({
    athleteName: entry.athlete.user.name,
    position: entry.position,
    result: entry.result,
  }));
};