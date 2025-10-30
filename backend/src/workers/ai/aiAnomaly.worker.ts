// backend/src/workers/ai/aiAnomaly.worker.ts

import { Job } from "bullmq";
import { logger } from "../../logger";
import { aiErrorHandler } from "../../lib/ai/aiErrorHandler";
import { fetchRecentAthleteData, fetchSystemEvents } from "../../lib/ai/dataUtils";
import { detectAnomalies } from "../../lib/ai/anomalyUtils";
import { recordAnomalyEvent } from "../../lib/ai/dbUtils";
import { notifyAdmins } from "../../lib/notifications";

/**
 * AI Anomaly Detection Worker
 * ------------------------------------------------------------
 * Monitors athlete and platform behavior to detect:
 *  - Suspicious account activity
 *  - Irregular performance jumps/drops
 *  - Unrealistic attendance/training entries
 *  - Data inconsistencies or API abuse
 */
export default async function (job: Job) {
  logger.info(`[AI ANOMALY] 🧠 Anomaly detection started for job ${job.id}`);

  try {
    const { athleteId, timeframe = 7 } = job.data;

    // Step 1: Collect all relevant activity data
    const [athleteData, systemEvents] = await Promise.all([
      fetchRecentAthleteData(athleteId, timeframe),
      fetchSystemEvents(timeframe),
    ]);

    // Step 2: Use AI/ML-based anomaly scoring
    const anomalies = await detectAnomalies({
      athleteData,
      systemEvents,
      sensitivity: 0.85, // adjustable sensitivity threshold
    });

    if (anomalies && anomalies.length > 0) {
      logger.warn(`[AI ANOMALY] ⚠️ Detected ${anomalies.length} anomalies for athlete ${athleteId}`);

      // Step 3: Log to database for future audit & analytics
      await recordAnomalyEvent(athleteId, anomalies);

      // Step 4: Alert admins with summarized anomalies
      await notifyAdmins({
        subject: "🚨 Anomaly Alert Detected",
        message: `AI detected irregularities in athlete or system behavior.`,
        data: anomalies.slice(0, 5), // limit to top 5 for notification
      });
    } else {
      logger.info(`[AI ANOMALY] ✅ No anomalies detected for athlete ${athleteId}`);
    }

    return {
      success: true,
      anomaliesDetected: anomalies?.length || 0,
    };
  } catch (error: any) {
    await aiErrorHandler("AI_ANOMALY_DETECTION", error);
    logger.error(`[AI ANOMALY] ❌ Job ${job.id} failed: ${error.message}`);
    throw error;
  }
}