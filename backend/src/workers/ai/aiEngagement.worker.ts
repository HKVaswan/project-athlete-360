// backend/src/workers/ai/aiEngagement.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";
import { fetchAthleteEngagementData } from "../../lib/ai/dataUtils";
import { calculateEngagementScore, detectDisengagement } from "../../lib/ai/engagementUtils";
import { saveEngagementReport } from "../../lib/ai/dbUtils";
import { notifyAdmins, notifyCoach } from "../../lib/notifications";

/**
 * AI Engagement Worker
 * ------------------------------------------
 * Detects athlete engagement patterns, motivation levels,
 * and potential burnout risk using attendance, messages,
 * and session participation analytics.
 */
export default async function (job: Job) {
  logger.info(`[AI ENGAGEMENT] 🧠 Starting engagement analysis for job ${job.id}`);

  try {
    const { athleteId, lookbackDays = 30 } = job.data;

    // Step 1: Fetch athlete's recent data (attendance, sessions, messages)
    const engagementData = await fetchAthleteEngagementData(athleteId, lookbackDays);

    // Step 2: Calculate engagement score (0–100)
    const engagementScore = calculateEngagementScore(engagementData);

    // Step 3: Detect disengagement or burnout patterns
    const disengagementSignals = detectDisengagement(engagementData, engagementScore);

    // Step 4: Save results into database
    await saveEngagementReport(athleteId, {
      engagementScore,
      disengagementSignals,
      analyzedAt: new Date(),
    });

    // Step 5: Notify responsible coach or admin if disengagement detected
    if (disengagementSignals?.length > 0 || engagementScore < 40) {
      logger.warn(`[AI ENGAGEMENT] ⚠️ Disengagement risk for athlete ${athleteId}`);
      await notifyCoach({
        athleteId,
        subject: "Athlete Engagement Alert",
        message: `Low engagement detected for athlete ${athleteId}. Score: ${engagementScore}`,
        data: disengagementSignals,
      });
    }

    logger.info(`[AI ENGAGEMENT] ✅ Job ${job.id} completed successfully`);

    return {
      success: true,
      engagementScore,
      disengagementSignals,
    };
  } catch (error: any) {
    await aiErrorHandler("AI_ENGAGEMENT_ANALYSIS", error);
    logger.error(`[AI ENGAGEMENT] ❌ Job ${job.id} failed: ${error.message}`);
    throw error;
  }
}