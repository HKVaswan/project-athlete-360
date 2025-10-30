/**
 * src/workers/ai/aiRecommendation.worker.ts
 * ------------------------------------------------------------------------
 * AI Recommendation Worker (Enterprise Grade)
 *
 * Purpose:
 *  - Generate personalized recommendations for athletes based on
 *    recent performance, session metrics, and risk insights.
 *  - Works in dual mode: heuristic (offline) or AI-powered (OpenAI/Custom AI).
 *
 * Features:
 *  - Pulls data from sessions, performance, injuries, and assessments.
 *  - Produces individualized short/long-term plans.
 *  - Sends notifications or stores insights for coaches.
 *  - Robust error handling and auto-retry integration.
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import axios from "axios";
import { config } from "../../config";
import { queues } from "../index";

const AI_PROVIDER_URL =
  process.env.AI_PROVIDER_URL ||
  config.aiProviderUrl ||
  "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || config.openaiKey;
const MODEL = process.env.AI_MODEL || "gpt-4o-mini";

type RecommendationJobPayload =
  | {
      type: "generateAthleteRecommendations";
      athleteId: string;
    }
  | {
      type: "generateBatchRecommendations";
      limit?: number;
    };

interface Recommendation {
  athleteId: string;
  summary: string;
  shortTermGoals: string[];
  longTermPlan: string[];
  focusAreas: string[];
  nutritionTips: string[];
}

/**
 * Heuristic (offline) recommendation generator
 * --------------------------------------------
 * Lightweight logic using existing performance metrics.
 */
async function heuristicRecommendations(athleteId: string): Promise<Recommendation> {
  const sessions = await prisma.session.findMany({
    where: { athleteId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (sessions.length === 0) {
    return {
      athleteId,
      summary: "No recent sessions found; recommend general training upkeep.",
      shortTermGoals: ["Log more sessions", "Maintain active recovery routine"],
      longTermPlan: ["Target consistent participation", "Build base endurance"],
      focusAreas: ["Consistency", "Baseline conditioning"],
      nutritionTips: ["Stay hydrated", "Increase protein intake for muscle repair"],
    };
  }

  const avgSpeed =
    sessions.reduce((acc, s) => acc + (s.speed || 0), 0) / sessions.length;
  const avgStamina =
    sessions.reduce((acc, s) => acc + (s.stamina || 0), 0) / sessions.length;
  const avgAccuracy =
    sessions.reduce((acc, s) => acc + (s.accuracy || 0), 0) / sessions.length;

  const summary = `Athlete ${athleteId} shows balanced performance: speed ${avgSpeed.toFixed(
    1
  )}, stamina ${avgStamina.toFixed(1)}, accuracy ${avgAccuracy.toFixed(1)}.`;

  const shortTermGoals = [];
  const longTermPlan = [];
  const focusAreas = [];
  const nutritionTips = [];

  if (avgSpeed < 50) {
    shortTermGoals.push("Focus on sprint drills 3x per week");
    focusAreas.push("Speed training");
  }
  if (avgStamina < 60) {
    longTermPlan.push("Endurance improvement over next 4–6 weeks");
    focusAreas.push("Stamina and aerobic capacity");
  }
  if (avgAccuracy < 70) {
    shortTermGoals.push("Add precision-based routines (balance, aim drills)");
    nutritionTips.push("Include omega-3 and B-vitamins for cognitive performance");
  }

  return {
    athleteId,
    summary,
    shortTermGoals,
    longTermPlan,
    focusAreas,
    nutritionTips,
  };
}

/**
 * AI-based Recommendation Generator
 * ---------------------------------
 * Uses OpenAI or a compatible endpoint for advanced suggestions.
 */
async function aiRecommendations(athleteId: string): Promise<Recommendation> {
  const sessions = await prisma.session.findMany({
    where: { athleteId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (!OPENAI_API_KEY || sessions.length === 0) {
    logger.warn("[AI RECOMMENDATION] No OpenAI key or session data, using heuristic mode.");
    return heuristicRecommendations(athleteId);
  }

  const summaryData = sessions
    .map(
      (s, i) =>
        `Session ${i + 1}: Speed=${s.speed ?? "N/A"}, Stamina=${s.stamina ?? "N/A"}, Accuracy=${s.accuracy ?? "N/A"}`
    )
    .join("\n");

  const prompt = `
Athlete performance data:
${summaryData}

You are an elite sports AI coach. Based on the data, generate:
1. A brief performance summary.
2. Three short-term goals (next 2 weeks).
3. Three long-term improvement strategies (next 2–3 months).
4. Three focus areas for training.
5. Three nutrition recommendations.

Keep the output structured and concise.
`;

  try {
    const resp = await axios.post(
      AI_PROVIDER_URL,
      {
        model: MODEL,
        messages: [
          { role: "system", content: "You are an expert sports coach AI." },
          { role: "user", content: prompt },
        ],
        max_tokens: 500,
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        timeout: 20000,
      }
    );

    const content = resp.data.choices?.[0]?.message?.content ?? "No AI response.";
    const parsed: Recommendation = {
      athleteId,
      summary: content.split("\n")[0] || "AI summary unavailable.",
      shortTermGoals: content.match(/short[- ]term goals?:([\s\S]*?)long[- ]term/i)?.[1]?.split("\n").filter(Boolean) ?? [],
      longTermPlan: content.match(/long[- ]term.*?:([\s\S]*?)focus/i)?.[1]?.split("\n").filter(Boolean) ?? [],
      focusAreas: content.match(/focus.*?:([\s\S]*?)nutrition/i)?.[1]?.split("\n").filter(Boolean) ?? [],
      nutritionTips: content.match(/nutrition.*?:([\s\S]*)/i)?.[1]?.split("\n").filter(Boolean) ?? [],
    };

    return parsed;
  } catch (err: any) {
    logger.error(`[AI RECOMMENDATION] API failure: ${err.message}`);
    return heuristicRecommendations(athleteId);
  }
}

/**
 * Persist AI/Heuristic Recommendations
 */
async function saveRecommendations(data: Recommendation) {
  const anyPrisma: any = prisma as any;
  if (typeof anyPrisma.aiInsight?.create !== "function") {
    logger.debug("[AI RECOMMENDATION] aiInsight model not found — skipping save.");
    return;
  }

  try {
    await anyPrisma.aiInsight.create({
      data: {
        athleteId: data.athleteId,
        type: "recommendation",
        source: "aiRecommendation.worker",
        content: JSON.stringify(data),
      },
    });
    logger.info(`[AI RECOMMENDATION] Stored recommendations for athlete ${data.athleteId}`);
  } catch (err: any) {
    logger.error(`[AI RECOMMENDATION] Failed to save: ${err.message}`);
  }
}

/**
 * Main Worker Processor
 */
export default async function (job: Job) {
  const { type } = job.data as RecommendationJobPayload;
  logger.info(`[AI RECOMMENDATION] Processing job ${job.id}: ${type}`);

  try {
    if (type === "generateAthleteRecommendations") {
      const { athleteId } = job.data;
      const rec = await aiRecommendations(athleteId);
      await saveRecommendations(rec);
      logger.info(`[AI RECOMMENDATION] Completed for athlete ${athleteId}`);
      return rec;
    }

    if (type === "generateBatchRecommendations") {
      const athletes = await prisma.athlete.findMany({
        select: { id: true },
        take: job.data.limit ?? 25,
      });

      for (const a of athletes) {
        await queues["aiRecommendation"]?.add(
          "generateAthleteRecommendations",
          { athleteId: a.id },
          { removeOnComplete: true, attempts: 2, backoff: { type: "exponential", delay: 3000 } }
        );
      }

      logger.info(`[AI RECOMMENDATION] Queued recommendations for ${athletes.length} athletes.`);
      return { queued: athletes.length };
    }

    logger.warn(`[AI RECOMMENDATION] Unknown job type: ${type}`);
    return null;
  } catch (err: any) {
    logger.error(`[AI RECOMMENDATION] Job ${job.id} failed: ${err.message}`);
    await queues["errorMonitor"]?.add("aiRecommendationError", {
      jobId: job.id,
      error: err.message,
    });
    throw err;
  }
}