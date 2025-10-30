// backend/src/workers/ai/aiTrendAnalysis.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";
import { fetchAthleteTimeSeries } from "../../lib/ai/dataUtils";
import { analyzeTrends, detectAnomalies } from "../../lib/ai/trendUtils";
import { saveTrendResults } from "../../lib/ai/dbUtils";
import { notifyAdmins } from "../../lib/notifications";

/**
 * AI Trend Analysis Worker
 * Detects medium and long-term performance trends for athletes.
 */
export default async function (job: Job) {
  logger.info(`[AI TREND] 📈 Starting trend analysis job ${job.id}`);

  try {
    const { athleteId, lookbackDays = 60 } = job.data;

    // Step 1: Fetch athlete’s time-series performance & wellness data
    const series = await fetchAthleteTimeSeries(athleteId, lookbackDays);

    // Step 2: Run trend analysis (moving averages, exponential smoothing, slope detection)
    const trendData = await analyzeTrends(series);

    // Step 3: Detect anomalies (e.g., sudden drops in performance or spikes in fatigue)
    const anomalies = await detectAnomalies(series, trendData);

    // Step 4: Save the AI trend results in database
    await saveTrendResults(athleteId, {
      trends: trendData,
      anomalies,
      analyzedAt: new Date(),
    });

    // Step 5: Notify coaches/admins if anomalies detected
    if (anomalies && anomalies.length > 0) {
      logger.warn(`[AI TREND] ⚠️ ${anomalies.length} anomalies detected for ${athleteId}`);
      await notifyAdmins({
        subject: "AI Trend Alert",
        message: `Performance anomalies detected for athlete ${athleteId}`,
        data: anomalies,
      });
    }

    logger.info(`[AI TREND] ✅ Trend analysis job ${job.id} completed successfully`);

    return { success: true, trends: trendData, anomalies };
  } catch (error: any) {
    await aiErrorHandler("AI_TREND_ANALYSIS", error);
    logger.error(`[AI TREND] ❌ Job failed: ${error.message}`);
    throw error;
  }
}