// backend/src/workers/ai/aiInsightGenerator.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { config } from "../../config";
import { aggregateAIInsights, detectTrends, generateSummary } from "../../lib/ai/insightUtils";
import { storeInsightToDB } from "../../lib/ai/dbUtils";
import { notifyAdmins } from "../../lib/notifications";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";

export default async function (job: Job) {
  logger.info(`[AI INSIGHT GENERATOR] 🧠 Processing job ${job.id}`);

  try {
    const { athleteId, range = "7d" } = job.data;

    // Step 1: Collect insights from AI modules
    const insights = await aggregateAIInsights(athleteId, range);

    // Step 2: Detect performance, nutrition, and mental trends
    const trends = await detectTrends(insights);

    // Step 3: Generate high-level summary
    const summary = await generateSummary(insights, trends);

    // Step 4: Save aggregated insight snapshot
    await storeInsightToDB({
      athleteId,
      insights,
      trends,
      summary,
      generatedAt: new Date(),
    });

    // Step 5: Optional — notify admins or coaches of major changes
    if (trends.performanceDrop || trends.wellnessWarning) {
      await notifyAdmins({
        subject: `⚠️ AI Insight Alert for Athlete ${athleteId}`,
        message: `Performance drop detected. Please review the AI summary.`,
      });
    }

    logger.info(`[AI INSIGHT GENERATOR] ✅ Insight generated successfully for athlete ${athleteId}`);

    return { success: true, summary };
  } catch (error: any) {
    await aiErrorHandler("AI_INSIGHT_GENERATOR", error);
    logger.error(`[AI INSIGHT GENERATOR] ❌ Failed: ${error.message}`);
    throw error;
  }
}