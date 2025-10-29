// src/services/session.service.ts
/**
 * Session Service (enterprise grade)
 *
 * Responsibilities:
 *  - Create / update / delete training sessions (transaction-safe)
 *  - Add / remove athletes to sessions
 *  - Bulk record attendance (efficient & idempotent)
 *  - Query sessions with filters + pagination
 *  - Fetch session detail including participants, attendance, assessments
 *
 * Notes:
 *  - This service intentionally keeps business rules here (not controllers).
 *  - Hooks for notifications / analytics are left as commented placeholders.
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate, computeNextCursor } from "../utils/pagination";

type CreateSessionPayload = {
  name: string;
  coachId?: string | null;
  date: string | Date;
  duration?: number | null;
  notes?: string | null;
  institutionId?: string | null;
  athleteIds?: string[]; // optional participants to attach on creation
};

type UpdateSessionPayload = Partial<CreateSessionPayload>;

export const createSession = async (payload: CreateSessionPayload, createdById?: string) => {
  const { name, coachId, date, duration, notes, institutionId, athleteIds } = payload;

  if (!name || !date) throw Errors.Validation("Session name and date are required");

  // basic institution check (if provided)
  if (institutionId) {
    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw Errors.NotFound("Institution not found");
  }

  // create session with optional participants in a single transaction
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        name,
        coachId: coachId || null,
        date: new Date(date),
        duration: duration ?? null,
        notes: notes ?? null,
        institutionId: institutionId ?? null,
      },
    });

    if (athleteIds && athleteIds.length > 0) {
      // connect only existing athletes — ignore missing ones
      const existing = await tx.athlete.findMany({
        where: { id: { in: athleteIds } },
        select: { id: true },
      });
      if (existing.length > 0) {
        await tx.session.update({
          where: { id: created.id },
          data: { athletes: { connect: existing.map((a) => ({ id: a.id })) } },
        });
      }
    }

    // Optional: emit notification to coach/institution (enqueue job)
    // notificationService.enqueueSessionCreated(created, createdById);

    return created;
  });

  logger.info(`Session created: ${session.id} (${session.name})`);
  return session;
};

export const getSessions = async (query: any, institutionId?: string) => {
  const where: any = {};
  if (institutionId) where.institutionId = institutionId;
  if (query.coachId) where.coachId = String(query.coachId);
  if (query.fromDate) where.date = { gte: new Date(String(query.fromDate)) };
  if (query.toDate) where.date = { ...(where.date || {}), lte: new Date(String(query.toDate)) };
  if (query.search) {
    where.name = { contains: String(query.search), mode: "insensitive" };
  }

  const { prismaArgs, meta } = await paginate(query, "offset", {
    where,
    countFn: (w) => prisma.session.count({ where: w }),
    includeTotal: true,
  });

  const sessions = await prisma.session.findMany({
    ...prismaArgs,
    where,
    include: {
      athletes: { select: { id: true, name: true, athleteCode: true, sport: true } },
      attendance: true,
      // avoid including heavy nested objects unless requested
    },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(sessions as any);
  return { data: sessions, meta };
};

export const getSessionById = async (sessionId: string) => {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      athletes: { include: { user: { select: { id: true, name: true, email: true } } } },
      attendance: { orderBy: { createdAt: "desc" } },
      assessments: true,
    },
  });

  if (!session) throw Errors.NotFound("Session not found");
  return session;
};

export const updateSession = async (sessionId: string, payload: UpdateSessionPayload) => {
  // validate dates if provided
  if (payload.date && Number.isNaN(new Date(payload.date as any).getTime())) {
    throw Errors.Validation("Invalid date format for session");
  }

  // Ensure institution exists if changed
  if (payload.institutionId) {
    const inst = await prisma.institution.findUnique({ where: { id: payload.institutionId } });
    if (!inst) throw Errors.NotFound("Institution not found");
  }

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: {
      name: payload.name,
      coachId: payload.coachId ?? undefined,
      date: payload.date ? new Date(payload.date) : undefined,
      duration: payload.duration ?? undefined,
      notes: payload.notes ?? undefined,
      institutionId: payload.institutionId ?? undefined,
    },
  });

  logger.info(`Session updated: ${sessionId}`);
  return updated;
};

export const deleteSession = async (sessionId: string) => {
  // transactionally remove attendance and link records then delete session
  await prisma.$transaction(async (tx) => {
    await tx.attendance.deleteMany({ where: { sessionId } });
    await tx.session.updateMany({
      where: { id: sessionId },
      data: { athletes: { set: [] } }, // detach relations
    });
    await tx.session.delete({ where: { id: sessionId } });
  });

  logger.warn(`Session deleted: ${sessionId}`);
  return { success: true };
};

/**
 * Add an athlete to a session (idempotent)
 */
export const addAthleteToSession = async (sessionId: string, athleteId: string) => {
  const [session, athlete] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId } }),
    prisma.athlete.findUnique({ where: { id: athleteId } }),
  ]);
  if (!session) throw Errors.NotFound("Session not found");
  if (!athlete) throw Errors.NotFound("Athlete not found");

  // idempotent connect
  const res = await prisma.session.update({
    where: { id: sessionId },
    data: { athletes: { connect: { id: athleteId } } },
  });

  logger.info(`Athlete ${athleteId} added to session ${sessionId}`);
  return res;
};

export const removeAthleteFromSession = async (sessionId: string, athleteId: string) => {
  await prisma.session.update({
    where: { id: sessionId },
    data: { athletes: { disconnect: { id: athleteId } } },
  });
  logger.info(`Athlete ${athleteId} removed from session ${sessionId}`);
  return { success: true };
};

/**
 * Bulk record attendance for a session.
 * - Accepts array of { athleteId, status, remarks }
 * - Uses upsert-like behavior: if attendance row exists, update; otherwise create
 * - Runs in transaction for atomicity
 */
export const recordAttendance = async (
  sessionId: string,
  records: { athleteId: string; status: "present" | "absent" | "late"; remarks?: string }[],
  recordedById?: string
) => {
  if (!Array.isArray(records) || records.length === 0) {
    throw Errors.Validation("Attendance records array required");
  }

  // Validate session exists
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw Errors.NotFound("Session not found");

  // run transactional upserts
  const results = await prisma.$transaction(
    records.map((r) =>
      prisma.attendance.upsert({
        where: {
          sessionId_athleteId: { sessionId, athleteId: r.athleteId },
        },
        update: {
          status: r.status,
          remarks: r.remarks ?? undefined,
        },
        create: {
          sessionId,
          athleteId: r.athleteId,
          status: r.status,
          remarks: r.remarks ?? undefined,
        },
      })
    )
  );

  // Optional: queue analytics or notify coach
  // analytics.enqueueAttendance(sessionId, records.length);
  // notificationService.notifySessionAttendanceUpdated(sessionId, recordedById);

  logger.info(`Recorded attendance for session ${sessionId} (${results.length} records)`);
  return results;
};

/**
 * Get sessions an athlete participated in (recent first)
 */
export const getAthleteSessions = async (athleteId: string, query: any = {}) => {
  const where: any = { athletes: { some: { id: athleteId } } };
  const { prismaArgs, meta } = await paginate(query, "offset", {
    where,
    countFn: (w) => prisma.session.count({ where: w }),
    includeTotal: true,
  });

  const sessions = await prisma.session.findMany({
    ...prismaArgs,
    where,
    orderBy: { date: "desc" },
    include: { attendance: { where: { athleteId }, orderBy: { createdAt: "desc" } }, assessments: true },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(sessions as any);
  return { data: sessions, meta };
};