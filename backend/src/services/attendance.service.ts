import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import logger from "../logger";

/**
 * Attendance Service
 * ------------------------
 * - Handles creation, update, and retrieval of athlete attendance.
 * - Each record links to an athlete, session (or date), and coach/admin.
 * - Designed for scalability: works for daily logs or bulk imports.
 * - Can be extended for biometric, GPS, or automated check-in integrations.
 */

export class AttendanceService {
  /**
   * Mark attendance for an athlete.
   * - Validates duplicate entry prevention.
   * - Supports manual or automatic (AI/IoT) tracking.
   */
  static async markAttendance({
    athleteId,
    sessionId,
    date,
    status,
    markedById,
  }: {
    athleteId: string;
    sessionId?: string;
    date?: Date | string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    markedById: string;
  }) {
    try {
      const attendanceDate = date ? new Date(date) : new Date();

      // Ensure no duplicate for the same athlete & date
      const existing = await prisma.attendance.findFirst({
        where: {
          athleteId,
          date: attendanceDate,
        },
      });

      if (existing) {
        throw Errors.Duplicate("Attendance already marked for this date");
      }

      const attendance = await prisma.attendance.create({
        data: {
          athleteId,
          sessionId,
          date: attendanceDate,
          status,
          markedById,
        },
      });

      logger.info(`✅ Attendance marked: ${athleteId} -> ${status}`);
      return attendance;
    } catch (err: any) {
      logger.error("❌ markAttendance failed: " + err.message);
      throw Errors.Server("Failed to mark attendance");
    }
  }

  /**
   * Update existing attendance entry
   */
  static async updateAttendance({
    attendanceId,
    status,
    remarks,
  }: {
    attendanceId: string;
    status?: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
    remarks?: string;
  }) {
    try {
      const attendance = await prisma.attendance.update({
        where: { id: attendanceId },
        data: { status, remarks },
      });

      logger.info(`✏️ Attendance updated: ${attendanceId}`);
      return attendance;
    } catch (err: any) {
      logger.error("❌ updateAttendance failed: " + err.message);
      throw Errors.Server("Failed to update attendance");
    }
  }

  /**
   * Get attendance summary for a specific athlete (optionally filtered by date range)
   */
  static async getAthleteAttendance({
    athleteId,
    startDate,
    endDate,
  }: {
    athleteId: string;
    startDate?: string | Date;
    endDate?: string | Date;
  }) {
    try {
      const where: any = { athleteId };
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      }

      const attendance = await prisma.attendance.findMany({
        where,
        orderBy: { date: "desc" },
      });

      // Calculate summary stats
      const summary = {
        total: attendance.length,
        present: attendance.filter((a) => a.status === "PRESENT").length,
        absent: attendance.filter((a) => a.status === "ABSENT").length,
        late: attendance.filter((a) => a.status === "LATE").length,
        excused: attendance.filter((a) => a.status === "EXCUSED").length,
      };

      return { attendance, summary };
    } catch (err: any) {
      logger.error("❌ getAthleteAttendance failed: " + err.message);
      throw Errors.Server("Failed to retrieve attendance");
    }
  }

  /**
   * Get attendance report for all athletes under a specific coach or institution
   */
  static async getInstitutionAttendance({
    institutionId,
    startDate,
    endDate,
  }: {
    institutionId: string;
    startDate?: string | Date;
    endDate?: string | Date;
  }) {
    try {
      const where: any = { athlete: { institutionId } };
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      }

      const attendance = await prisma.attendance.findMany({
        where,
        include: {
          athlete: { select: { id: true, name: true, sport: true } },
        },
        orderBy: { date: "desc" },
      });

      return attendance;
    } catch (err: any) {
      logger.error("❌ getInstitutionAttendance failed: " + err.message);
      throw Errors.Server("Failed to fetch institution attendance");
    }
  }

  /**
   * Delete attendance record (admin only)
   */
  static async deleteAttendance(attendanceId: string) {
    try {
      await prisma.attendance.delete({ where: { id: attendanceId } });
      logger.warn(`🗑️ Attendance deleted: ${attendanceId}`);
      return { success: true };
    } catch (err: any) {
      logger.error("❌ deleteAttendance failed: " + err.message);
      throw Errors.Server("Failed to delete attendance");
    }
  }
}

export default AttendanceService;