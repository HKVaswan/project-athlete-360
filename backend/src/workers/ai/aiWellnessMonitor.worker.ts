// src/workers/ai/aiWellnessMonitor.worker.ts

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";

/**
 * Thresholds for risk evaluation
 */
const STRESS_HIGH_THRESHOLD = 0.75;
const SLEEP_LOW_THRESHOLD = 6;
const NUTRITION_LOW_SCORE = 0.6;

/**
 * Utility to clamp a number between 0 and 1
 */
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/**
 * Compute composite wellness score (0–100)
 */
const computeWellnessScore = (data: {
  sleepHours?: number;
  stressLevel?: number; // 0–1
  nutritionScore?: number; // 0–1
  mood?: number; // 0–1
}) => {
  const sleepScore = clamp((data.sleepHours ?? 7) / 8, 0, 1);
  const stressScore = 1 - clamp(data.stressLevel ?? 0.5, 0, 1);
  const nutrition = clamp(data.nutritionScore ?? 0.7, 0, 1);
  const moodScore = clamp(data.mood ?? 0.8, 0, 1);

  const overall = (sleepScore * 0.3 + stressScore * 0.3 + nutrition * 0.25 + moodScore * 0.15) * 100;
  return Math.round(overall);
};

/**
 * Detect wellness anomalies (used for alerts)
 */
const detectAnomalies = (score: number, stress: number, sleep: number, nutrition: number) => {
  const alerts: string[] = [];

  if (score < 60) alerts.push("Overall wellness critically low.");
  if (stress > STRESS_HIGH_THRESHOLD) alerts.push("High stress levels detected.");
  if (sleep < SLEEP_LOW_THRESHOLD) alerts.push("Inadequate sleep duration.");
  if (nutrition < NUTRITION_LOW_SCORE) alerts.push("Poor nutrition habits detected.");

  return alerts;
};

/**
 * Main Worker
 */
export default async function (job: Job<{ athleteId: string }>) {
  const { athleteId } = job.data;
  logger.info(`[AI:WellnessMonitor] Running wellness analysis for athlete ${athleteId}`);

  try {
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        wellnessLogs: { orderBy: { date: "desc" }, take: 7 },
        aiInsights: true,
      },
    });

    if (!athlete) {
      logger.warn(`[AI:WellnessMonitor] Athlete not found: ${athleteId}`);
      return { success: false };
    }

    // Aggregate latest data
    const recent = athlete.wellnessLogs[0];
    if (!recent) {
      logger.info(`[AI:WellnessMonitor] No recent logs found for athlete ${athleteId}`);
      return { success: true, message: "no_recent_logs" };
    }

    const wellnessScore = computeWellnessScore({
      sleepHours: recent.sleepHours,
      stressLevel: recent.stressLevel,
      nutritionScore: recent.nutritionScore,
      mood: recent.moodScore,
    });

    const alerts = detectAnomalies(
      wellnessScore,
      recent.stressLevel ?? 0,
      recent.sleepHours ?? 0,
      recent.nutritionScore ?? 0
    );

    // Persist AI insights
    await prisma.aiInsights.upsert({
      where: { athleteId },
      update: {
        wellnessScore,
        risks: { stressRisk: recent.stressLevel, nutritionRisk: 1 - (recent.nutritionScore ?? 0) },
        lastUpdated: new Date(),
      },
      create: {
        athleteId,
        wellnessScore,
        risks: { stressRisk: recent.stressLevel, nutritionRisk: 1 - (recent.nutritionScore ?? 0) },
      },
    });

    // Dispatch alerts if any
    if (alerts.length > 0 && queues["aiAlerts"]) {
      await queues["aiAlerts"].add("wellness_alert", {
        athleteId,
        alerts,
        score: wellnessScore,
        createdAt: new Date().toISOString(),
      });
      logger.info(`[AI:WellnessMonitor] Alerts queued for athlete ${athleteId}`);
    }

    // Log completion
    logger.info(`[AI:WellnessMonitor] Completed for athlete ${athleteId} (score=${wellnessScore})`);
    return { success: true, wellnessScore, alerts };
  } catch (err: any) {
    logger.error(`[AI:WellnessMonitor] Failed for athlete ${athleteId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}