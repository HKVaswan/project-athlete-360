// backend/src/workers/ai/aiCorrelation.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";
import { fetchAthleteMetrics } from "../../lib/ai/dataUtils";
import { calculateCorrelations } from "../../lib/ai/mathUtils";
import { saveCorrelationResults } from "../../lib/ai/dbUtils";
import { notifyAdmins } from "../../lib/notifications";

/**
 * AI Correlation Worker
 * Finds cross-domain relationships between training, recovery, nutrition, and performance.
 */
export default async function (job: Job) {
  logger.info(`[AI CORRELATION] 🔍 Starting correlation job ${job.id}`);

  try {
    const { athleteId, lookbackDays = 30 } = job.data;

    // Step 1: Fetch recent athlete data across all domains
    const data = await fetchAthleteMetrics(athleteId, lookbackDays);

    // Step 2: Compute correlations (Pearson / Spearman / Mutual Info)
    const correlations = await calculateCorrelations(data);

    // Step 3: Save correlation results to DB for analytics visualization
    await saveCorrelationResults(athleteId, correlations);

    // Step 4: Detect abnormal dependencies or risk patterns
    const highImpact = correlations.filter((c) => Math.abs(c.coefficient) > 0.7);
    if (highImpact.length > 0) {
      logger.warn(`[AI CORRELATION] ⚠️ Strong correlations detected for ${athleteId}`);
      await notifyAdmins({
        subject: "AI Correlation Alert",
        message: `Significant correlation patterns detected for athlete ${athleteId}`,
        data: highImpact,
      });
    }

    logger.info(`[AI CORRELATION] ✅ Job ${job.id} completed successfully`);

    return { success: true, correlations, highImpact };
  } catch (error: any) {
    await aiErrorHandler("AI_CORRELATION", error);
    logger.error(`[AI CORRELATION] ❌ Failed: ${error.message}`);
    throw error;
  }
}