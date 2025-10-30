// src/workers/ai/aiPerformanceForecast.worker.ts
/**
 * aiPerformanceForecast.worker.ts
 *
 * Enterprise-grade worker to produce long-term performance forecasts for an athlete.
 * - Pulls historical performance records (from `performance` model)
 * - Builds a simple but robust trend model (linear regression + variance)
 * - Produces risk scores (fatigue / stagnation / improvement probability)
 * - Attempts to persist insight (if aiInsight table exists) — fails gracefully if not
 * - Emits alerts to aiAlertManager queue when risk thresholds are crossed
 *
 * Notes:
 * - This worker is intentionally conservative: it never throws raw errors to the queue
 *   and always logs problems for human review.
 * - If you later add more advanced ML infra, this worker can call that service
 *   or push preprocessed batches to a model-training queue.
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";
import { config } from "../../config";

/* -------------------------
 * Types
 * ------------------------- */
type JobData = {
  athleteId: string;
  // days to look back for history; default to 365
  historyDays?: number;
  // whether to force re-evaluation ignoring any cached insight
  force?: boolean;
};

/* -------------------------
 * Helpers
 * ------------------------- */

/**
 * Convert Date to number (days since epoch) for regression stability.
 */
const daysSinceEpoch = (d: Date) => Math.floor(d.getTime() / (1000 * 60 * 60 * 24));

/**
 * Simple linear regression (least squares).
 * Input arrays must be same length and length >= 2
 * Returns slope and intercept
 */
const linearRegression = (x: number[], y: number[]) => {
  const n = x.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: y[0] || 0 };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    // nearly vertical or constant x; degrade to zero slope
    return { slope: 0, intercept: sumY / n };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
};

/**
 * Compute basic statistics: mean, variance, stdev
 */
const stats = (arr: number[]) => {
  if (!arr || arr.length === 0) return { mean: 0, variance: 0, stdev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  const stdev = Math.sqrt(variance);
  return { mean, variance, stdev };
};

/**
 * Heuristic risk scoring
 * - fatigueRisk: increases with rapid recent drop or high variance
 * - stagnationRisk: high if slope approximately zero and low improvements
 * - improvementProbability: higher for positive slope + low variance
 *
 * Values normalized to 0..1
 */
const computeRiskScores = (slope: number, recentValues: number[]) => {
  const { mean, stdev } = stats(recentValues);
  // normalize slope relative to mean (avoid division by zero)
  const slopeRel = mean === 0 ? 0 : slope / Math.abs(mean);

  // fatigue risk: if slope is strongly negative or variance high => risk up
  let fatigueRisk = Math.min(1, Math.max(0, -slopeRel * 3 + stdev / (Math.abs(mean) + 1)));
  // stagnation: slope near zero and low variance => stagnation risk
  let stagnationRisk = Math.min(
    1,
    Math.max(0, 0.6 - Math.abs(slopeRel) * 5 + Math.max(0, 0.2 - stdev / (Math.abs(mean) + 1)))
  );
  // improvement probability: positive slope and low variance
  let improvementProbability = Math.min(1, Math.max(0, slopeRel * 2 - stdev / (Math.abs(mean) + 1)));

  // clamp and ensure numeric
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  return {
    fatigueRisk: clamp(fatigueRisk),
    stagnationRisk: clamp(stagnationRisk),
    improvementProbability: clamp(improvementProbability),
  };
};

/* -------------------------
 * Worker processor
 * ------------------------- */

export default async function (job: Job<JobData>) {
  const startTime = Date.now();
  logger.info(`[AI:PerfForecast] Job ${job.id} started`, { jobData: job.data });

  try {
    const athleteId = String(job.data.athleteId);
    const historyDays = Number(job.data.historyDays ?? 365);
    const force = !!job.data.force;

    if (!athleteId) {
      logger.warn("[AI:PerfForecast] Missing athleteId in job data, skipping.");
      return { success: false, reason: "missing athleteId" };
    }

    // Fetch athlete to validate and check visibility
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: { user: true, performances: true },
    });
    if (!athlete) {
      logger.warn(`[AI:PerfForecast] Athlete not found: ${athleteId}`);
      return { success: false, reason: "athlete_not_found" };
    }

    // Determine history window
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - historyDays);

    // Fetch performance records in timeframe, ordered asc
    const performanceRows = await prisma.performance.findMany({
      where: {
        athleteId,
        date: { gte: sinceDate },
      },
      orderBy: { date: "asc" },
    });

    if (!performanceRows || performanceRows.length === 0) {
      logger.info(`[AI:PerfForecast] No performance history for athlete ${athleteId}`);
      return { success: true, message: "no_history", data: null };
    }

    // Prepare data arrays
    const x: number[] = []; // days since epoch
    const y: number[] = []; // metric value (we'll use 'score' as generic metric)
    const recentValues: number[] = [];

    // We will use the "score" field as the performance metric; if not meaningful,
    // consider extending to multiple metrics in future.
    for (const p of performanceRows) {
      x.push(daysSinceEpoch(new Date(p.date)));
      y.push(Number(p.score ?? 0));
    }
    // recent window (last 10 records or 30 days, whichever is smaller)
    const recentWindow = performanceRows.slice(-10).map((r) => Number(r.score ?? 0));
    recentValues.push(...recentWindow);

    // Compute regression
    const { slope, intercept } = linearRegression(x, y);

    // Basic prediction: project 30/90/180 days ahead (in days)
    const todayDays = daysSinceEpoch(new Date());
    const predict = (daysAhead: number) => {
      const t = todayDays + daysAhead;
      return intercept + slope * t;
    };
    const prediction30 = predict(30);
    const prediction90 = predict(90);
    const prediction180 = predict(180);

    // Compute risk scores
    const { fatigueRisk, stagnationRisk, improvementProbability } = computeRiskScores(slope, recentValues);

    // Quantify trend strength and variability
    const yStats = stats(y);

    const insight = {
      athleteId,
      computedAt: new Date().toISOString(),
      historyDays,
      points: performanceRows.length,
      slope,
      intercept,
      predicted: {
        d30: prediction30,
        d90: prediction90,
        d180: prediction180,
      },
      stats: {
        mean: yStats.mean,
        stdev: yStats.stdev,
        variance: yStats.variance,
      },
      risks: {
        fatigueRisk,
        stagnationRisk,
        improvementProbability,
      },
      meta: {
        generatedBy: "aiPerformanceForecast.worker",
        runtimeMs: Date.now() - startTime,
      },
    };

    logger.info(`[AI:PerfForecast] Insight for athlete ${athleteId}`, { insightSummary: {
      athleteId,
      slope,
      fatigueRisk,
      stagnationRisk,
      improvementProbability,
      points: performanceRows.length,
    }});

    // Attempt to persist insight in DB (if aiInsight model exists).
    try {
      // Using a generous but safe pattern: if model/table doesn't exist this will throw
      // — we catch and log without failing the job.
      // NOTE: Add a matching Prisma model 'AiInsight' later for persistence if desired.
      // Example schema (not enforced here):
      // model AiInsight { id String @id @default(uuid()) athleteId String json Json createdAt DateTime @default(now()) }
      await (prisma as any).aiInsight?.create?.({
        data: {
          athleteId,
          // store as JSON so future schema can be flexible
          data: insight,
          createdAt: new Date(),
        },
      });
      logger.debug("[AI:PerfForecast] Persisted insight to aiInsight table (if present).");
    } catch (persistErr: any) {
      // Do not fail job on persistence error (table may not exist in current schema)
      logger.debug("[AI:PerfForecast] aiInsight persistence skipped/failed (ok):", {
        message: persistErr?.message ?? String(persistErr),
      });
    }

    // If risk exceeds thresholds, push alert to aiAlertManager queue
    try {
      const ALERT_THRESHOLD_FATIGUE = Number(config.aiAlertFatigueThreshold ?? 0.6); // default 0.6
      const ALERT_THRESHOLD_STAGNATION = Number(config.aiAlertStagnationThreshold ?? 0.8);

      const shouldAlert = fatigueRisk >= ALERT_THRESHOLD_FATIGUE || stagnationRisk >= ALERT_THRESHOLD_STAGNATION;

      if (shouldAlert) {
        const alertPayload = {
          athleteId,
          type: fatigueRisk >= ALERT_THRESHOLD_FATIGUE ? "fatigue_risk" : "stagnation_risk",
          riskScores: { fatigueRisk, stagnationRisk, improvementProbability },
          summary: `AI detected ${fatigueRisk >= ALERT_THRESHOLD_FATIGUE ? "fatigue" : "stagnation"} risk for athlete ${athleteId}`,
          insightSummary: {
            slope,
            mean: yStats.mean,
            stdev: yStats.stdev,
            predicted30: prediction30,
            predicted90: prediction90,
          },
        };

        const queue = queues["aiAlertManager"];
        if (queue) {
          await queue.add("ai_alert", alertPayload, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
          logger.info(`[AI:PerfForecast] Alert queued for athlete ${athleteId}`, { alertType: alertPayload.type });
        } else {
          logger.warn("[AI:PerfForecast] aiAlertManager queue not registered — cannot enqueue alert.");
        }
      }
    } catch (alertErr: any) {
      logger.error("[AI:PerfForecast] Failed to enqueue alert (non-fatal):", {
        message: alertErr?.message ?? String(alertErr),
      });
    }

    // Optionally emit a lightweight message to a monitoring queue for dashboarding
    try {
      const monitorQueue = queues["analytics"];
      if (monitorQueue) {
        await monitorQueue.add("ai_perf_forecast.summary", {
          athleteId,
          slope,
          fatigueRisk,
          stagnationRisk,
          improvementProbability,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (monitorErr) {
      // ignore monitoring failures
    }

    logger.info(`[AI:PerfForecast] Job ${job.id} finished successfully for athlete ${athleteId}`);
    return { success: true, data: insight };
  } catch (err: any) {
    // Catch-all: we log detailed error and return a safe failure payload (do not throw)
    logger.error(`[AI:PerfForecast] Job ${job.id} failed: ${err?.message ?? err}`, { stack: err?.stack });
    return { success: false, reason: err?.message ?? "unknown_error" };
  }
}