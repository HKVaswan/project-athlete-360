/**
 * aiAnalytics.worker.ts
 * ---------------------------------------------------------------------
 * AI Analytics Worker
 *
 * Responsibilities:
 *  - Analyze system-wide athlete and institution performance trends.
 *  - Detect anomalies and flag underperformance or overtraining risk.
 *  - Summarize analytics for admins, coaches, and AI dashboards.
 *  - Optionally enrich insights with natural-language summaries (LLM safe call).
 *
 * Features:
 *  - Safe aggregation via Prisma
 *  - Scalable chunk processing
 *  - Resilient AI enrichment (non-blocking)
 *  - Logs and returns structured analytics report
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { safeAIInvoke } from "../../utils/aiUtils";
import { Errors } from "../../utils/errors";

interface AIAnalyticsPayload {
  period?: "week" | "month" | "quarter";
  institutionId?: string | null;
  sport?: string | null;
}

export default async function (job: Job<AIAnalyticsPayload>) {
  const { period = "month", institutionId = null, sport = null } = job.data;
  logger.info(`[AI_ANALYTICS] Starting job ${job.id} for ${period} analytics.`);

  try {
    const sinceDate = getSinceDate(period);

    // Step 1: Fetch performances for given period
    const performances = await prisma.performance.findMany({
      where: {
        date: { gte: sinceDate },
        ...(institutionId ? { athlete: { institutionId } } : {}),
        ...(sport ? { athlete: { sport } } : {}),
      },
      include: {
        athlete: {
          select: { id: true, name: true, athleteCode: true, sport: true },
        },
      },
    });

    if (performances.length === 0) {
      logger.warn(`[AI_ANALYTICS] No performance data found for selected period.`);
      return { success: true, message: "No data for analysis", analytics: [] };
    }

    // Step 2: Compute aggregated stats
    const stats = aggregatePerformanceStats(performances);

    // Step 3: Identify anomalies or training risks
    const anomalies = detectAnomalies(stats);

    // Step 4: Prepare AI summary
    let aiSummary = null;
    try {
      aiSummary = await safeAIInvoke(async (aiClient) => {
        const prompt = `
        You are an AI sports analyst. Summarize the following metrics for the ${period}:
        - Average performance score: ${stats.avgPerformance.toFixed(2)}
        - Consistency: ${stats.consistency.toFixed(2)}
        - Improvement trend: ${stats.trend.toFixed(2)}
        - Total athletes analyzed: ${stats.totalAthletes}
        - Notable anomalies: ${anomalies.length}

        Provide a short human-readable summary for coaches and admins (under 60 words).
        `;
        return await aiClient?.summarize?.(prompt);
      });
    } catch (err) {
      logger.warn(`[AI_ANALYTICS] AI enrichment failed, falling back to static summary.`);
      aiSummary = `Average performance is ${stats.avgPerformance.toFixed(
        2
      )} with ${anomalies.length} anomalies detected.`;
    }

    // Step 5: Return structured analytics output
    const result = {
      success: true,
      period,
      totalAthletes: stats.totalAthletes,
      avgPerformance: stats.avgPerformance,
      consistency: stats.consistency,
      trend: stats.trend,
      anomalies,
      summary: aiSummary,
    };

    await job.updateProgress(100);
    logger.info(`[AI_ANALYTICS] Job ${job.id} completed successfully.`);
    return result;
  } catch (err: any) {
    logger.error(`[AI_ANALYTICS] Job failed: ${err.message}`);
    throw Errors.Server("AI analytics processing failed");
  }
}

/**
 * Helper: Determine date range
 */
function getSinceDate(period: "week" | "month" | "quarter") {
  const date = new Date();
  if (period === "week") date.setDate(date.getDate() - 7);
  else if (period === "month") date.setMonth(date.getMonth() - 1);
  else date.setMonth(date.getMonth() - 3);
  return date;
}

/**
 * Aggregates athlete performance metrics
 */
function aggregatePerformanceStats(records: any[]) {
  const scores = records.map((r) => Number(r.score)).filter((n) => !Number.isNaN(n));
  const avgPerformance = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  const totalAthletes = new Set(records.map((r) => r.athleteId)).size;

  // Compute consistency (inverse of variance)
  const mean = avgPerformance;
  const variance = scores.reduce((a, s) => a + Math.pow(s - mean, 2), 0) / (scores.length || 1);
  const consistency = Math.max(0, 1 - Math.min(1, variance / (mean || 1)));

  // Simple trend (avg of last quarter of data vs first quarter)
  const sorted = records.sort((a, b) => a.date - b.date);
  const q = Math.max(3, Math.floor(sorted.length / 4));
  const firstQ = avg(sorted.slice(0, q).map((r) => Number(r.score)));
  const lastQ = avg(sorted.slice(-q).map((r) => Number(r.score)));
  const trend = lastQ - firstQ;

  return { avgPerformance, totalAthletes, consistency, trend };
}

/**
 * Detect anomalies in athlete scores
 */
function detectAnomalies(stats: ReturnType<typeof aggregatePerformanceStats>) {
  const anomalies: { type: string; message: string }[] = [];

  if (stats.consistency < 0.6) anomalies.push({ type: "inconsistency", message: "Athlete performance fluctuating heavily" });
  if (stats.trend < -2) anomalies.push({ type: "decline", message: "Overall decline in performance detected" });
  if (stats.avgPerformance < 50) anomalies.push({ type: "low-performance", message: "Low average performance trend" });

  return anomalies;
}

/**
 * Helper for averages
 */
function avg(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}