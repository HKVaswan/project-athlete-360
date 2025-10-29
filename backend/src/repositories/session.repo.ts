/**
 * session.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for Training Sessions.
 *
 * Features:
 *  - Create/update/delete sessions
 *  - Assign athletes & mark attendance
 *  - Fetch sessions by coach, athlete, or institution
 *  - Designed for large-scale usage (pagination, filtering)
 *  - Future-ready for AI-based session performance analysis
 */

import { Prisma, Session, Attendance } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class SessionRepository {
  /**
   * Create a new training session.
   * Ensures valid institution and coach references.
   */
  async createSession(data: Prisma.SessionCreateInput): Promise<Session> {
    try {
      return await prisma.session.create({ data });
    } catch (err: any) {
      if (err?.code === "P2003") throw Errors.BadRequest("Invalid coach or institution reference.");
      throw Errors.Server("Failed to create session.");
    }
  }

  /**
   * Get session details by ID (with participants and attendance)
   */
  async getSessionById(id: string) {
    try {
      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          coach: { select: { id: true, name: true } },
          institution: { select: { id: true, name: true } },
          attendance: {
            include: {
              athlete: { select: { id: true, name: true, sport: true } },
            },
          },
        },
      });

      if (!session) throw Errors.NotFound("Session not found.");
      return session;
    } catch (err) {
      throw Errors.Server("Failed to fetch session details.");
    }
  }

  /**
   * List sessions for a coach (with optional filters)
   */
  async getCoachSessions(coachId: string, options?: { from?: Date; to?: Date; status?: string }) {
    try {
      const where: Prisma.SessionWhereInput = { coachId };
      if (options?.from || options?.to)
        where.date = { gte: options.from, lte: options.to ?? new Date() };
      if (options?.status) where.status = options.status as any;

      return await prisma.session.findMany({
        where,
        include: { _count: { select: { attendance: true } } },
        orderBy: { date: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch coach sessions.");
    }
  }

  /**
   * List sessions for an athlete (through attendance link)
   */
  async getAthleteSessions(athleteId: string) {
    try {
      return await prisma.attendance.findMany({
        where: { athleteId },
        include: {
          session: {
            select: {
              id: true,
              name: true,
              date: true,
              duration: true,
              coach: { select: { name: true } },
            },
          },
        },
        orderBy: { session: { date: "desc" } },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete sessions.");
    }
  }

  /**
   * Mark athlete attendance for a session.
   * Creates or updates attendance entry.
   */
  async markAttendance(
    sessionId: string,
    athleteId: string,
    status: "PRESENT" | "ABSENT",
    notes?: string
  ): Promise<Attendance> {
    try {
      return await prisma.attendance.upsert({
        where: { athleteId_sessionId: { athleteId, sessionId } },
        update: { status, notes },
        create: { sessionId, athleteId, status, notes },
      });
    } catch (err) {
      throw Errors.Server("Failed to mark attendance.");
    }
  }

  /**
   * Update session details (for rescheduling or changes)
   */
  async updateSession(id: string, data: Prisma.SessionUpdateInput) {
    try {
      return await prisma.session.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Session not found.");
      throw Errors.Server("Failed to update session.");
    }
  }

  /**
   * Delete a session (admin or coach-level)
   */
  async deleteSession(id: string) {
    try {
      await prisma.session.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Session not found.");
      throw Errors.Server("Failed to delete session.");
    }
  }

  /**
   * Get institutional summary (for dashboards)
   * Counts total sessions and attendance stats.
   */
  async getInstitutionSummary(institutionId: string) {
    try {
      const totalSessions = await prisma.session.count({ where: { institutionId } });
      const totalAttendance = await prisma.attendance.count({
        where: { session: { institutionId }, status: "PRESENT" },
      });
      return { totalSessions, totalAttendance };
    } catch (err) {
      throw Errors.Server("Failed to fetch institution session summary.");
    }
  }
}

export const sessionRepository = new SessionRepository();