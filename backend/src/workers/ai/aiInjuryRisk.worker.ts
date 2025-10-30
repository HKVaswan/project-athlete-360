// backend/src/workers/ai/aiInjuryRisk.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";
import { fetchAthleteTrainingData } from "../../lib/ai/dataUtils";
import { analyzeInjuryRisk } from "../../lib/ai/injuryUtils";
import { saveInjuryRiskReport } from "../../lib/ai/dbUtils";
import { notifyCoach, notifyAdmins } from "../../lib/notifications";

/**
 * AI Injury Risk Worker
 * ----------------------------------------------------
 * Predicts potential injuries based on workload balance,
 * training load, rest patterns, attendance, and performance drops.
 */
export default async function (job: Job) {
  logger.info(`[AI INJURY-RISK] ⚙️ Starting injury prediction for job ${job.id}`);

  try {
    const { athleteId, lookbackDays = 21 } = job.data;

    // Step 1: Collect training, attendance & performance data
    const trainingData = await fetchAthleteTrainingData(athleteId, lookbackDays);

    // Step 2: Run AI model to compute risk probability
    const riskAssessment = await analyzeInjuryRisk(trainingData);

    // Step 3: Store risk report to DB
    await saveInjuryRiskReport(athleteId, {
      riskLevel: riskAssessment.riskLevel,
      contributingFactors: riskAssessment.factors,
      predictedOn: new Date(),
    });

    // Step 4: Notify coach/admin if risk is medium/high
    if (riskAssessment.riskLevel === "HIGH" || riskAssessment.riskLevel === "MEDIUM") {
      logger.warn(
        `[AI INJURY-RISK] ⚠️ Athlete ${athleteId} at ${riskAssessment.riskLevel} injury risk`
      );

      await notifyCoach({
        athleteId,
        subject: "⚠️ Injury Risk Alert",
        message: `AI detected a ${riskAssessment.riskLevel} risk of injury for athlete ${athleteId}.`,
        data: riskAssessment.factors,
      });
    }

    logger.info(`[AI INJURY-RISK] ✅ Job ${job.id} completed successfully`);

    return {
      success: true,
      riskLevel: riskAssessment.riskLevel,
      details: riskAssessment.factors,
    };
  } catch (error: any) {
    await aiErrorHandler("AI_INJURY_RISK_ANALYSIS", error);
    logger.error(`[AI INJURY-RISK] ❌ Job ${job.id} failed: ${error.message}`);
    throw error;
  }
}