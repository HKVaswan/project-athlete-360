/**
 * workers/aiInsights.worker.ts
 * ------------------------------------------------------------------------
 * AI Insights Worker (Enterprise-Grade)
 *
 * Purpose:
 *  - Periodically analyze athlete data (sessions, performances, injuries)
 *  - Generate AI-based insights: improvement areas, fatigue risks, trend reports
 *  - Store these insights back into DB for dashboards
 *
 * Enterprise Features:
 *  - Modular AI connector (OpenAI / TensorFlow / custom ML API)
 *  - Automatic retries with exponential backoff
 *  - Offline processing (runs via queue or CRON)
 *  - Safely handles model API failures
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import prisma from "../prismaClient";
import { config } from "../config";
import { analyzePerformanceData } from "../integrations/ai/aiClient"; // optional connector

/**
 * Job data interface
 */
interface AIInsightJob {
  athleteId?: string;
  mode: "weekly" | "onDemand";
}

/**
 * Worker entry point
 */
export default async function (job: Job<AIInsightJob>) {
  logger.info(`[AI WORKER] 🧠 Processing AI Insight Job ${job.id}`);

  const { athleteId, mode } = job.data;

  try {
    if (athleteId) {
      await processAthleteInsights(athleteId, mode);
    } else {
      await processAllAthletes(mode);
    }

    logger.info(`[AI WORKER] ✅ AI Insight job ${job.id} completed successfully`);
  } catch (err: any) {
    logger.error(`[AI WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Process insights for all athletes (e.g. weekly batch)
 */
async function processAllAthletes(mode: string) {
  const athletes = await prisma.athlete.findMany({
    select: { id: true },
  });

  for (const athlete of athletes) {
    await processAthleteInsights(athlete.id, mode);
  }
}

/**
 * Process insights for a single athlete
 */
async function processAthleteInsights(athleteId: string, mode: string) {
  const sessions = await prisma.session.findMany({
    where: { athleteId },
    orderBy: { date: "desc" },
    take: 10,
    select: {
      id: true,
      performanceScore: true,
      duration: true,
      intensity: true,
      fatigueLevel: true,
      createdAt: true,
    },
  });

  const performances = await prisma.performance.findMany({
    where: { athleteId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      metric: true,
      value: true,
      createdAt: true,
    },
  });

  if (!sessions.length && !performances.length) {
    logger.warn(`[AI WORKER] No data found for athlete ${athleteId}`);
    return;
  }

  // 🔮 Call AI analysis function (mocked or real API)
  const aiResponse = await analyzePerformanceData({
    sessions,
    performances,
    context: { athleteId, mode },
  });

  // 🧾 Store insights in DB
  await prisma.aiInsight.create({
    data: {
      athleteId,
      summary: aiResponse.summary ?? "No insights available",
      improvementAreas: aiResponse.improvementAreas ?? [],
      fatigueRisk: aiResponse.fatigueRisk ?? "Unknown",
      recommendations: aiResponse.recommendations ?? [],
      createdAt: new Date(),
    },
  });

  logger.info(`[AI WORKER] 🧩 AI insights stored for athlete ${athleteId}`);
}