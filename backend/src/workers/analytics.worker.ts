/**
 * workers/analytics.worker.ts
 * --------------------------------------------------------------------------
 * Analytics Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Periodically compute and store athlete/institution performance analytics.
 *  - Generate dashboards & statistical summaries asynchronously.
 *  - Detect trends or anomalies (AI-ready).
 *
 * Features:
 *  - Robust error handling and retry logic.
 *  - Efficient aggregation queries.
 *  - Extensible for future AI predictive modules.
 */

import { Job } from "bullmq";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { notificationRepository } from "../repositories/notification.repo";
import { emitSocketNotification } from "../lib/socket";

type AnalyticsJobPayload = {
  target: "athlete" | "institution" | "global";
  targetId?: string; // athleteId or institutionId
};

export default async function (job: Job<AnalyticsJobPayload>) {
  const { target, targetId } = job.data;
  logger.info(`[ANALYTICS WORKER] 📊 Processing analytics for: ${target} (${targetId || "all"})`);

  try {
    switch (target) {
      case "athlete":
        await generateAthleteAnalytics(targetId!);
        break;

      case "institution":
        await generateInstitutionAnalytics(targetId!);
        break;

      case "global":
        await generateGlobalAnalytics();
        break;

      default:
        logger.warn(`[ANALYTICS WORKER] Unknown target: ${target}`);
        break;
    }

    logger.info(`[ANALYTICS WORKER] ✅ Analytics job completed successfully.`);
  } catch (err: any) {
    logger.error(`[ANALYTICS WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Generate athlete-level analytics
 */
async function generateAthleteAnalytics(athleteId: string) {
  const sessions = await prisma.session.findMany({
    where: { athleteId },
    select: { performanceScore: true, attendance: true, createdAt: true },
  });

  if (sessions.length === 0) return;

  const avgScore =
    sessions.reduce((sum, s) => sum + (s.performanceScore || 0), 0) / sessions.length;
  const attendanceRate =
    sessions.filter((s) => s.attendance === "present").length / sessions.length;

  await prisma.athleteAnalytics.upsert({
    where: { athleteId },
    update: { avgScore, attendanceRate, updatedAt: new Date() },
    create: { athleteId, avgScore, attendanceRate },
  });

  logger.info(`[ANALYTICS WORKER] Athlete analytics updated for ${athleteId}`);
}

/**
 * Generate institution-level analytics
 */
async function generateInstitutionAnalytics(institutionId: string) {
  const athletes = await prisma.athlete.findMany({ where: { institutionId }, select: { id: true } });

  if (athletes.length === 0) return;

  const athleteIds = athletes.map((a) => a.id);

  const performanceStats = await prisma.session.aggregate({
    where: { athleteId: { in: athleteIds } },
    _avg: { performanceScore: true },
    _count: { _all: true },
  });

  const attendanceStats = await prisma.session.groupBy({
    by: ["attendance"],
    where: { athleteId: { in: athleteIds } },
    _count: { attendance: true },
  });

  const presentCount = attendanceStats.find((a) => a.attendance === "present")?._count.attendance || 0;
  const totalSessions = performanceStats._count._all || 0;
  const attendanceRate = totalSessions > 0 ? presentCount / totalSessions : 0;

  await prisma.institutionAnalytics.upsert({
    where: { institutionId },
    update: {
      avgPerformance: performanceStats._avg.performanceScore || 0,
      attendanceRate,
      updatedAt: new Date(),
    },
    create: {
      institutionId,
      avgPerformance: performanceStats._avg.performanceScore || 0,
      attendanceRate,
    },
  });

  logger.info(`[ANALYTICS WORKER] Institution analytics updated for ${institutionId}`);
}

/**
 * Generate global platform analytics
 */
async function generateGlobalAnalytics() {
  const totalAthletes = await prisma.athlete.count();
  const totalInstitutions = await prisma.institution.count();
  const totalSessions = await prisma.session.count();

  const avgPerformance = await prisma.session.aggregate({
    _avg: { performanceScore: true },
  });

  await prisma.platformAnalytics.upsert({
    where: { id: 1 }, // singleton row
    update: {
      totalAthletes,
      totalInstitutions,
      totalSessions,
      avgPerformance: avgPerformance._avg.performanceScore || 0,
      updatedAt: new Date(),
    },
    create: {
      id: 1,
      totalAthletes,
      totalInstitutions,
      totalSessions,
      avgPerformance: avgPerformance._avg.performanceScore || 0,
    },
  });

  // Notify admin if performance trends drop below threshold
  if ((avgPerformance._avg.performanceScore || 0) < 50) {
    const admins = await prisma.user.findMany({ where: { role: "admin" } });
    const alertTitle = "⚠️ Global Performance Drop Detected";
    const alertBody = "Average athlete performance has fallen below the threshold.";

    for (const admin of admins) {
      await notificationRepository.create({
        userId: admin.id,
        type: "analyticsAlert",
        title: alertTitle,
        body: alertBody,
      });

      emitSocketNotification(admin.id, { title: alertTitle, body: alertBody });
    }

    logger.warn(`[ANALYTICS WORKER] ⚠️ Global performance drop alert triggered.`);
  }

  logger.info(`[ANALYTICS WORKER] Global analytics updated successfully.`);
}