/**
 * attendance.repo.ts
 * ---------------------------------------------------------------------
 * Repository for managing athlete attendance records.
 *
 * Features:
 *  - Atomic insert/update with uniqueness constraints (athleteId + sessionId)
 *  - Safe queries for analytics (present %, per-session, per-athlete)
 *  - Audit fields maintained automatically
 *  - Prisma optimized for minimal round-trips
 *  - Ready for caching & AI analysis layer
 */

import { Prisma, Attendance } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";

export class AttendanceRepository {
  /**
   * Mark attendance for an athlete in a session.
   * If record already exists → update it safely.
   */
  async markAttendance(
    athleteId: string,
    sessionId: string,
    status: "PRESENT" | "ABSENT" | "LATE",
    remarks?: string
  ): Promise<Attendance> {
    try {
      return await prisma.attendance.upsert({
        where: { athleteId_sessionId: { athleteId, sessionId } },
        update: { status, remarks, updatedAt: new Date() },
        create: { athleteId, sessionId, status, remarks },
      });
    } catch (err: any) {
      if (err?.code === "P2003") throw Errors.BadRequest("Invalid athlete or session reference.");
      throw Errors.Server("Failed to mark attendance.");
    }
  }

  /**
   * Get attendance for a specific session (for coach/admin view)
   */
  async getSessionAttendance(sessionId: string) {
    try {
      return await prisma.attendance.findMany({
        where: { sessionId },
        include: {
          athlete: {
            select: { id: true, name: true, athleteCode: true, sport: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch session attendance.");
    }
  }

  /**
   * Get attendance for a specific athlete (with filters)
   */
  async getAthleteAttendance(athleteId: string, options?: { from?: Date; to?: Date }) {
    try {
      const where: Prisma.AttendanceWhereInput = { athleteId };
      if (options?.from || options?.to) {
        where.createdAt = {
          gte: options.from,
          lte: options.to ?? new Date(),
        };
      }

      return await prisma.attendance.findMany({
        where,
        include: {
          session: {
            select: { id: true, title: true, date: true, coachId: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (err) {
      throw Errors.Server("Failed to fetch athlete attendance.");
    }
  }

  /**
   * Compute athlete’s overall attendance percentage
   * Optionally scoped by date or institution.
   */
  async getAthleteAttendanceStats(
    athleteId: string,
    options?: { from?: Date; to?: Date; institutionId?: string }
  ) {
    try {
      const where: Prisma.AttendanceWhereInput = { athleteId };
      if (options?.from || options?.to)
        where.createdAt = { gte: options.from, lte: options.to ?? new Date() };

      if (options?.institutionId) {
        where.session = { institutionId: options.institutionId };
      }

      const total = await prisma.attendance.count({ where });
      if (total === 0) return { total: 0, present: 0, percentage: 0 };

      const present = await prisma.attendance.count({
        where: { ...where, status: "PRESENT" },
      });

      return {
        total,
        present,
        percentage: Math.round((present / total) * 100),
      };
    } catch (err) {
      throw Errors.Server("Failed to compute attendance stats.");
    }
  }

  /**
   * Delete attendance record (admin only)
   */
  async deleteAttendanceRecord(id: string) {
    try {
      await prisma.attendance.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === "P2025") throw Errors.NotFound("Attendance record not found.");
      throw Errors.Server("Failed to delete attendance record.");
    }
  }
}

export const attendanceRepository = new AttendanceRepository();