/**
 * src/workers/ai/aiPerformance.worker.ts
 * ------------------------------------------------------------------------
 * AI Performance Worker (Enterprise Grade)
 *
 * Purpose:
 *  - Analyze athlete performance metrics (speed, endurance, accuracy, etc.)
 *  - Identify trends, improvement suggestions, and risk indicators.
 *  - Works with or without external AI API integration.
 *
 * Design:
 *  - Pulls data from performance/session tables
 *  - Generates insights using heuristic or AI model
 *  - Saves generated reports to aiInsights table
 *  - Queues notifications if anomalies or risks detected
 *
 * Dependencies:
 *  - prisma (Performance, Athlete, Session tables)
 *  - axios (for optional AI integration)
 *  - bullmq (for async job processing)
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import axios from "axios";
import { config } from "../../config";
import { queues } from "../index";

// Optional AI Provider Configuration
const AI_PROVIDER_URL =
  process.env.AI_PROVIDER_URL ||
  config.aiProviderUrl ||
  "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || config.openaiKey;
const MODEL = process.env.AI_MODEL || "gpt-4o-mini";

type PerformanceJobPayload =
  | {
      type: "analyzeAthletePerformance";
      athleteId: string;
      sessionRange?: number; // e.g. last N sessions
    }
  | {
      type: "analyzeAllPerformances";
      limit?: number;
    }
  | {
      type: "detectPerformanceRisk";
      athleteId: string;
    };

interface PerformanceInsight {
  athleteId: string;
  summary: string;
  keyMetrics: Record<string, number | string>;
  recommendations: string[];
  riskLevel?: "low" | "medium" | "high";
}

/**
 * Heuristic Performance Analyzer
 * (Used when AI API not available)
 */
async function heuristicAnalyzePerformance(athleteId: string, sessions: any[]): Promise<PerformanceInsight> {
  const metrics = {
    avgSpeed: 0,
    avgStamina: 0,
    avgAccuracy: 0,
    totalSessions: sessions.length,
  };

  for (const s of sessions) {
    metrics.avgSpeed += s.speed || 0;
    metrics.avgStamina += s.stamina || 0;
    metrics.avgAccuracy += s.accuracy || 0;
  }

  if (sessions.length > 0) {
    metrics.avgSpeed /= sessions.length;
    metrics.avgStamina /= sessions.length;
    metrics.avgAccuracy /= sessions.length;
  }

  const recommendations: string[] = [];
  let riskLevel: "low" | "medium" | "high" = "low";

  if (metrics.avgStamina < 60) {
    recommendations.push("Improve endurance training intensity gradually.");
    riskLevel = "medium";
  }
  if (metrics.avgAccuracy < 50) {
    recommendations.push("Focus on precision drills and consistent form.");
    riskLevel = "medium";
  }
  if (metrics.avgSpeed < 40) {
    recommendations.push("Include sprint intervals and speed-based agility work.");
    riskLevel = "high";
  }

  return {
    athleteId,
    summary: `Performance summary for athlete ${athleteId}`,
    keyMetrics: metrics,
    recommendations,
    riskLevel,
  };
}

/**
 * AI-Powered Performance Analyzer (Optional)
 */
async function aiAnalyzePerformance(athleteId: string, sessions: any[]): Promise<PerformanceInsight> {
  if (!OPENAI_API_KEY) {
    logger.warn("[AI PERFORMANCE] No OpenAI key found, using heuristic mode.");
    return heuristicAnalyzePerformance(athleteId, sessions);
  }

  const avgMetrics = {
    speed: sessions.reduce((a, b) => a + (b.speed || 0), 0) / sessions.length || 0,
    stamina: sessions.reduce((a, b) => a + (b.stamina || 0), 0) / sessions.length || 0,
    accuracy: sessions.reduce((a, b) => a + (b.accuracy || 0), 0) / sessions.length || 0,
  };

  const prompt = `
Analyze the following athlete performance data and provide:
1. Summary of trends.
2. 2-3 personalized recommendations.
3. Overall risk level (low, medium, high).

Athlete ID: ${athleteId}
Average Speed: ${avgMetrics.speed.toFixed(2)}
Average Stamina: ${avgMetrics.stamina.toFixed(2)}
Average Accuracy: ${avgMetrics.accuracy.toFixed(2)}
`;

  try {
    const resp = await axios.post(
      AI_PROVIDER_URL,
      {
        model: MODEL,
        messages: [
          { role: "system", content: "You are a sports performance analysis assistant." },
          { role: "user", content: prompt },
        ],
        max_tokens: 400,
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        timeout: 20_000,
      }
    );

    const resultText = resp.data.choices?.[0]?.message?.content ?? "No analysis result.";
    return {
      athleteId,
      summary: resultText,
      keyMetrics: avgMetrics,
      recommendations: ["See summary above for personalized insights."],
    };
  } catch (err: any) {
    logger.error(`[AI PERFORMANCE] AI API failed: ${err.message}`);
    return heuristicAnalyzePerformance(athleteId, sessions);
  }
}

/**
 * Store generated AI insight in database
 */
async function savePerformanceInsight(athleteId: string, insight: PerformanceInsight) {
  const anyPrisma: any = prisma as any;
  if (typeof anyPrisma.aiInsight?.create !== "function") {
    logger.debug("[AI PERFORMANCE] aiInsight table not found — skipping persist.");
    return;
  }

  try {
    await anyPrisma.aiInsight.create({
      data: {
        athleteId,
        type: "performance",
        source: "aiPerformance.worker",
        content: JSON.stringify(insight),
      },
    });
    logger.info(`[AI PERFORMANCE] Insight saved for athlete ${athleteId}`);
  } catch (err: any) {
    logger.error(`[AI PERFORMANCE] Failed to store insight: ${err.message}`);
  }
}

/**
 * Main Worker Processor
 */
export default async function (job: Job) {
  const { type } = job.data as PerformanceJobPayload;
  logger.info(`[AI PERFORMANCE] Processing job ${job.id}: ${type}`);

  try {
    if (type === "analyzeAthletePerformance") {
      const { athleteId, sessionRange = 5 } = job.data;
      const sessions = await prisma.session.findMany({
        where: { athleteId },
        orderBy: { createdAt: "desc" },
        take: sessionRange,
      });

      if (sessions.length === 0) throw new Error("No recent sessions found.");

      const insight = await aiAnalyzePerformance(athleteId, sessions);
      await savePerformanceInsight(athleteId, insight);

      logger.info(`[AI PERFORMANCE] Completed analysis for athlete ${athleteId}`);
      return insight;
    }

    if (type === "analyzeAllPerformances") {
      const athletes = await prisma.athlete.findMany({
        select: { id: true },
        take: job.data.limit ?? 50,
      });

      for (const a of athletes) {
        await queues["aiPerformance"]?.add(
          "analyzeAthletePerformance",
          { athleteId: a.id, sessionRange: 5 },
          { removeOnComplete: true, attempts: 2, backoff: { type: "exponential", delay: 2000 } }
        );
      }

      logger.info(`[AI PERFORMANCE] Queued performance analysis for ${athletes.length} athletes.`);
      return { queued: athletes.length };
    }

    if (type === "detectPerformanceRisk") {
      const { athleteId } = job.data;
      const sessions = await prisma.session.findMany({
        where: { athleteId },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      const insight = await heuristicAnalyzePerformance(athleteId, sessions);
      if (insight.riskLevel === "high") {
        await queues["notifications"]?.add(
          "riskAlert",
          {
            athleteId,
            message: `⚠️ Athlete ${athleteId} shows high-risk performance trends.`,
          },
          { removeOnComplete: true }
        );
        logger.warn(`[AI PERFORMANCE] High-risk alert generated for athlete ${athleteId}`);
      }

      return insight;
    }

    logger.warn(`[AI PERFORMANCE] Unknown job type: ${type}`);
    return null;
  } catch (err: any) {
    logger.error(`[AI PERFORMANCE] Job ${job.id} failed: ${err.message}`);
    await queues["errorMonitor"]?.add("aiPerformanceError", {
      jobId: job.id,
      error: err.message,
    });
    throw err;
  }
}