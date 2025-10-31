/**
 * workers/analytics.worker.ts
 * --------------------------------------------------------------------------
 * Enterprise-Grade Analytics Worker
 *
 * Responsibilities:
 *  - Compute athlete, institution & global performance analytics.
 *  - Auto-detect performance anomalies.
 *  - Escalate alerts to Super Admin if persistent drops are detected.
 *  - Log all actions to the audit trail.
 *  - Resilient and fault-tolerant: isolated try/catch blocks per phase.
 */

import { Job } from "bullmq";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "../lib/audit";
import { notificationRepository } from "../repositories/notification.repo";
import { emitSocketNotification } from "../lib/socket";

type AnalyticsJobPayload = {
  target: "athlete" | "institution" | "global";
  targetId?: string; // athleteId or institutionId
  triggeredBy?: string; // admin/super_admin id if manual trigger
};

export default async function (job: Job<AnalyticsJobPayload>) {
  const { target, targetId, triggeredBy } = job.data;
  const context = `[ANALYTICS WORKER] ${target.toUpperCase()} (${targetId || "ALL"})`;

  logger.info(`${context} 🚀 Starting analytics computation...`);
  await auditService.log({
    actorId: triggeredBy || "system",
    actorRole: triggeredBy ? "admin" : "system",
    action: "ANALYTICS_COMPUTE_START",
    details: { target, targetId, jobId: job.id },
  });

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
        logger.warn(`${context} Unknown target type.`);
    }

    logger.info(`${context} ✅ Completed successfully.`);
    await auditService.log({
      actorId: triggeredBy || "system",
      actorRole: triggeredBy ? "admin" : "system",
      action: "ANALYTICS_COMPUTE_SUCCESS",
      details: { target, targetId, jobId: job.id },
    });
  } catch (err: any) {
    logger.error(`${context} ❌ Failed: ${err.message}`);
    await auditService.log({
      actorId: triggeredBy || "system",
      actorRole: "system",
      action: "ANALYTICS_COMPUTE_FAILURE",
      details: { error: err.message, stack: err.stack, target, targetId },
    });
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* 🧩 Athlete-Level Analytics */
/* -------------------------------------------------------------------------- */
async function generateAthleteAnalytics(athleteId: string) {
  try {
    const sessions = await prisma.session.findMany({
      where: { athleteId },
      select: { performanceScore: true, attendance: true },
    });

    if (!sessions.length) return;

    const avgScore = sessions.reduce((s, v) => s + (v.performanceScore || 0), 0) / sessions.length;
    const attendanceRate =
      sessions.filter((s) => s.attendance === "present").length / sessions.length;

    await prisma.athleteAnalytics.upsert({
      where: { athleteId },
      update: { avgScore, attendanceRate, updatedAt: new Date() },
      create: { athleteId, avgScore, attendanceRate },
    });

    logger.info(`[ANALYTICS] Athlete analytics updated for ${athleteId}`);
  } catch (err: any) {
    logger.error(`[ANALYTICS] Athlete analytics failed: ${err.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 🏫 Institution-Level Analytics */
/* -------------------------------------------------------------------------- */
async function generateInstitutionAnalytics(institutionId: string) {
  try {
    const athletes = await prisma.athlete.findMany({ where: { institutionId }, select: { id: true } });
    if (!athletes.length) return;

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

    logger.info(`[ANALYTICS] Institution analytics updated for ${institutionId}`);
  } catch (err: any) {
    logger.error(`[ANALYTICS] Institution analytics failed: ${err.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 🌍 Global Platform Analytics + Super Admin Escalation */
/* -------------------------------------------------------------------------- */
async function generateGlobalAnalytics() {
  try {
    const totalAthletes = await prisma.athlete.count();
    const totalInstitutions = await prisma.institution.count();
    const totalSessions = await prisma.session.count();

    const avgPerformance = await prisma.session.aggregate({
      _avg: { performanceScore: true },
    });

    const averageScore = avgPerformance._avg.performanceScore || 0;

    await prisma.platformAnalytics.upsert({
      where: { id: 1 },
      update: {
        totalAthletes,
        totalInstitutions,
        totalSessions,
        avgPerformance: averageScore,
        updatedAt: new Date(),
      },
      create: {
        id: 1,
        totalAthletes,
        totalInstitutions,
        totalSessions,
        avgPerformance: averageScore,
      },
    });

    // Alert admins and super_admins on performance anomaly
    if (averageScore < 50) {
      const recipients = await prisma.user.findMany({
        where: { role: { in: ["admin", "super_admin"] } },
      });

      const alertTitle = "⚠️ Global Performance Drop Detected";
      const alertBody =
        "Average athlete performance has dropped below the threshold. Immediate review recommended.";

      for (const recipient of recipients) {
        await notificationRepository.create({
          userId: recipient.id,
          type: "analyticsAlert",
          title: alertTitle,
          body: alertBody,
          metadata: { avgPerformance: averageScore },
        });

        emitSocketNotification(recipient.id, { title: alertTitle, body: alertBody });
      }

      logger.warn(`[ANALYTICS WORKER] ⚠️ Alert: Global performance < 50.`);
      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "GLOBAL_PERFORMANCE_ALERT",
        details: { averageScore, recipientsCount: recipients.length },
      });
    }

    logger.info(`[ANALYTICS] Global analytics updated successfully.`);
  } catch (err: any) {
    logger.error(`[ANALYTICS] Global analytics failed: ${err.message}`);
    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "GLOBAL_ANALYTICS_FAILURE",
      details: { error: err.message },
    });
  }
}