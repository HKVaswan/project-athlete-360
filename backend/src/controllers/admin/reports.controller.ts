/**
 * src/controllers/admin/reports.controller.ts
 * ---------------------------------------------------------------------------
 * Centralized Admin Reporting Controller
 *
 * Features:
 *  - Generates cross-domain reports (athletes, attendance, sessions, institutions)
 *  - Supports CSV / JSON output for admin export
 *  - Modular: can easily extend for AI-assisted reports in the future
 *  - Optimized queries using Prisma aggregations
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { Errors } from "../../utils/errors";
import { logger } from "../../logger";
import { Parser as CsvParser } from "json2csv";

/**
 * 📊 GET /admin/reports/overview
 * Summary report across the entire platform
 */
export const getSystemOverviewReport = async (req: Request, res: Response) => {
  try {
    const [athletes, institutions, sessions, competitions] = await Promise.all([
      prisma.athlete.count(),
      prisma.institution.count(),
      prisma.session.count(),
      prisma.competition.count(),
    ]);

    const report = {
      totalAthletes: athletes,
      totalInstitutions: institutions,
      totalSessions: sessions,
      totalCompetitions: competitions,
      generatedAt: new Date().toISOString(),
    };

    return res.status(200).json({ success: true, data: report });
  } catch (err: any) {
    logger.error("❌ Failed to generate overview report:", err);
    throw Errors.Server("Failed to generate system overview report.");
  }
};

/**
 * 🏫 GET /admin/reports/institution-performance
 * Aggregated performance stats per institution
 */
export const getInstitutionPerformanceReport = async (req: Request, res: Response) => {
  try {
    const data = await prisma.institution.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            athletes: true,
            sessions: true,
            competitions: true,
          },
        },
      },
    });

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    logger.error("❌ Institution performance report failed:", err);
    throw Errors.Server("Failed to generate institution performance report.");
  }
};

/**
 * 📅 GET /admin/reports/attendance
 * Attendance statistics grouped by institution or sport
 */
export const getAttendanceReport = async (req: Request, res: Response) => {
  try {
    const report = await prisma.attendance.groupBy({
      by: ["institutionId"],
      _count: { id: true },
      _avg: { attendancePercentage: true },
    });

    return res.status(200).json({ success: true, data: report });
  } catch (err: any) {
    logger.error("❌ Attendance report generation failed:", err);
    throw Errors.Server("Failed to generate attendance report.");
  }
};

/**
 * 🧾 GET /admin/reports/export
 * Exports system data in CSV format
 */
export const exportReportAsCSV = async (req: Request, res: Response) => {
  try {
    const athletes = await prisma.athlete.findMany({
      select: { id: true, name: true, sport: true, institutionId: true, createdAt: true },
    });

    const csv = new CsvParser({
      fields: ["id", "name", "sport", "institutionId", "createdAt"],
    }).parse(athletes);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=athlete_report.csv");
    res.status(200).send(csv);
  } catch (err: any) {
    logger.error("❌ CSV export failed:", err);
    throw Errors.Server("Failed to export data as CSV.");
  }
};