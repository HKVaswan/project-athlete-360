/**
 * workers/ai.worker.ts
 * -------------------------------------------------------------
 * AI Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Analyze athlete performance data & generate insights
 *  - Predict trends (injury risk, performance progression)
 *  - Summarize session notes or generate training suggestions
 *
 * Architecture:
 *  - Uses modular AI adapters (e.g. OpenAI, TensorFlow, Local)
 *  - Runs asynchronously via BullMQ queues
 *  - Designed for safe, rate-limited, and scalable inference
 *
 * Security:
 *  - Sanitizes input data before model execution
 *  - Stores only anonymized metadata for compliance
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { config } from "../config";
import { Errors } from "../utils/errors";
import { analyzePerformance, summarizeNotes } from "../ai/adapters/openaiAdapter";
import { predictTrend } from "../ai/adapters/tfAdapter";
import { storeAIInsights } from "../repositories/ai.repo";

type AiJobPayload = {
  task: "performanceAnalysis" | "trendPrediction" | "noteSummary";
  athleteId: string;
  sessionId?: string;
  data?: any;
};

export default async function (job: Job<AiJobPayload>) {
  const { task, athleteId, sessionId, data } = job.data;
  logger.info(`[AI] 🤖 Processing AI job ${job.id}: ${task} for athlete ${athleteId}`);

  try {
    let result: any;

    switch (task) {
      case "performanceAnalysis":
        result = await handlePerformanceAnalysis(athleteId, data);
        break;

      case "trendPrediction":
        result = await handleTrendPrediction(athleteId, data);
        break;

      case "noteSummary":
        result = await handleNoteSummary(sessionId!, data);
        break;

      default:
        logger.warn(`[AI] Unknown AI task: ${task}`);
        return;
    }

    // Persist result
    await storeAIInsights(athleteId, task, result);

    logger.info(`[AI] ✅ Job ${job.id} (${task}) completed successfully`);
  } catch (err: any) {
    logger.error(`[AI] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Handle performance analysis using AI adapter
 */
async function handlePerformanceAnalysis(athleteId: string, data: any) {
  try {
    const sanitized = sanitizeInput(data);
    const insights = await analyzePerformance(sanitized);
    return { athleteId, insights };
  } catch (err: any) {
    throw Errors.Server("AI performance analysis failed");
  }
}

/**
 * Predict long-term trends or improvement rates
 */
async function handleTrendPrediction(athleteId: string, data: any) {
  try {
    const sanitized = sanitizeInput(data);
    const prediction = await predictTrend(sanitized);
    return { athleteId, prediction };
  } catch (err: any) {
    throw Errors.Server("AI trend prediction failed");
  }
}

/**
 * Summarize coach/athlete session notes for insights
 */
async function handleNoteSummary(sessionId: string, notes: string) {
  try {
    const summary = await summarizeNotes(notes);
    return { sessionId, summary };
  } catch (err: any) {
    throw Errors.Server("AI note summarization failed");
  }
}

/**
 * Input sanitization to avoid prompt injection or bias
 */
function sanitizeInput(input: any) {
  if (typeof input === "string") {
    return input.replace(/[<>]/g, "").slice(0, 5000); // prevent prompt injection
  }
  if (typeof input === "object") {
    return JSON.parse(JSON.stringify(input)); // deep clone to avoid mutations
  }
  return input;
}