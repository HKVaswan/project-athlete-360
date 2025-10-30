// src/workers/ai/aiEngagementMonitor.worker.ts

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";

const MIN_SESSION_ATTENDANCE = 0.6;
const MIN_MESSAGE_ACTIVITY = 0.4;
const STREAK_DROP_THRESHOLD = 0.5;

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/**
 * Compute engagement score (0–100)
 */
const computeEngagementScore = (data: {
  sessionsAttended: number;
  sessionsPlanned: number;
  messageActivity: number;
  recentStreak: number;
  coachInteractions: number;
}) => {
  const attendance = clamp(data.sessionsAttended / (data.sessionsPlanned || 1));
  const activity = clamp(data.messageActivity);
  const streak = clamp(data.recentStreak);
  const coachInteract = clamp(data.coachInteractions / 5);

  const score = (attendance * 0.4 + activity * 0.25 + streak * 0.25 + coachInteract * 0.1) * 100;
  return Math.round(score);
};

/**
 * Detect anomalies (low engagement or burnout signals)
 */
const detectEngagementAnomalies = (score: number, metrics: any) => {
  const alerts: string[] = [];

  if (score < 60) alerts.push("Low engagement detected.");
  if (metrics.sessionsAttended / (metrics.sessionsPlanned || 1) < MIN_SESSION_ATTENDANCE)
    alerts.push("Poor session attendance.");
  if (metrics.messageActivity < MIN_MESSAGE_ACTIVITY) alerts.push("Low in-app activity.");
  if (metrics.recentStreak < STREAK_DROP_THRESHOLD) alerts.push("Motivation streak drop detected.");

  return alerts;
};

/**
 * Main Worker
 */
export default async function (job: Job<{ athleteId: string }>) {
  const { athleteId } = job.data;
  logger.info(`[AI:EngagementMonitor] Analyzing engagement for athlete ${athleteId}`);

  try {
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        sessions: {
          where: { date: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } }, // past 30 days
          select: { id: true, attended: true },
        },
        messagesSent: {
          where: { createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14) } },
          select: { id: true },
        },
        aiInsights: true,
      },
    });

    if (!athlete) {
      logger.warn(`[AI:EngagementMonitor] Athlete not found: ${athleteId}`);
      return { success: false };
    }

    // Basic metrics
    const sessionsPlanned = athlete.sessions.length;
    const sessionsAttended = athlete.sessions.filter((s) => s.attended).length;
    const messageActivity = athlete.messagesSent.length / 10; // normalized
    const recentStreak = Math.random() * 0.8 + 0.2; // Placeholder: real streak calc later
    const coachInteractions = Math.floor(Math.random() * 5); // Placeholder metric

    const engagementScore = computeEngagementScore({
      sessionsPlanned,
      sessionsAttended,
      messageActivity,
      recentStreak,
      coachInteractions,
    });

    const alerts = detectEngagementAnomalies(engagementScore, {
      sessionsPlanned,
      sessionsAttended,
      messageActivity,
      recentStreak,
    });

    await prisma.aiInsights.upsert({
      where: { athleteId },
      update: {
        engagementScore,
        lastUpdated: new Date(),
      },
      create: {
        athleteId,
        engagementScore,
      },
    });

    // Queue alerts if needed
    if (alerts.length > 0 && queues["aiAlerts"]) {
      await queues["aiAlerts"].add("engagement_alert", {
        athleteId,
        alerts,
        engagementScore,
        createdAt: new Date().toISOString(),
      });
      logger.info(`[AI:EngagementMonitor] Alerts queued for athlete ${athleteId}`);
    }

    logger.info(`[AI:EngagementMonitor] Completed for athlete ${athleteId} (score=${engagementScore})`);
    return { success: true, engagementScore, alerts };
  } catch (err: any) {
    logger.error(`[AI:EngagementMonitor] Failed for athlete ${athleteId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}