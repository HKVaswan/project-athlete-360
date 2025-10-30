/**
 * aiScout.worker.ts
 * ---------------------------------------------------------------------
 * AI Scout Worker
 *
 * Purpose:
 *  - Analyze athletes across an institution (or global) to identify
 *    high-potential prospects for specific sports/goals.
 *  - Uses hybrid ranking (rules + ML/LLM enrichment).
 *  - Emits structured recommendations (scores, reasons, tags).
 *
 * Enterprise features:
 *  - Pagination-safe fetch of athlete data (prevents heavy queries)
 *  - Configurable scoring engine + weight overrides
 *  - Optional AI enrichment via safeAIInvoke (to produce human-friendly rationale)
 *  - Progress reporting using BullMQ job.progress()
 *  - Defensive coding, retries via queue config, and clear logging
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { safeAIInvoke } from "../../utils/aiUtils";
import { computeNextCursor } from "../../utils/pagination";

type ScoutPayload = {
  institutionId?: string | null; // scope: optional (null => global)
  sport?: string | null;
  limit?: number; // how many athletes to evaluate per run (safety)
  goal?: "professional" | "development" | "rehab" | "collegiate";
  minAssessments?: number; // filter threshold
  weights?: {
    recentPerformance?: number;
    consistency?: number;
    injuryHistory?: number; // negative weight
    growthRate?: number;
    attendance?: number;
  };
};

type AthleteSummary = {
  athleteId: string;
  name: string;
  athleteCode?: string;
  sport?: string | null;
  avgScore?: number | null;
  consistency?: number | null;
  recentTrend?: number | null;
  injuryCount?: number | null;
  attendanceRate?: number | null;
  raw: any;
  score: number;
  reason?: string; // AI or heuristic summary
};

const DEFAULT_LIMIT = 200;
const HARD_MAX_LIMIT = 1000;

/**
 * Default scoring weights
 */
const DEFAULT_WEIGHTS = {
  recentPerformance: 0.4,
  consistency: 0.25,
  injuryHistory: -0.2,
  growthRate: 0.2,
  attendance: 0.15,
};

export default async function (job: Job<ScoutPayload>) {
  logger.info(`[AI_SCOUT] Starting scout job ${job.id}`);
  try {
    const {
      institutionId = null,
      sport = null,
      limit = DEFAULT_LIMIT,
      goal = "development",
      minAssessments = 3,
      weights = {},
    } = job.data;

    // enforce sensible limits
    const safeLimit = Math.min(HARD_MAX_LIMIT, Math.max(10, limit || DEFAULT_LIMIT));
    const mergedWeights = { ...DEFAULT_WEIGHTS, ...(weights || {}) };

    // Step 1: fetch candidate athletes (paged)
    logger.info(`[AI_SCOUT] Fetching up to ${safeLimit} athletes (institution=${institutionId} sport=${sport})`);
    const athletes = await prisma.athlete.findMany({
      where: {
        institutionId: institutionId ?? undefined,
        sport: sport ?? undefined,
        approved: true,
      },
      include: {
        performances: { orderBy: { date: "desc" }, take: 12 },
        assessments: { orderBy: { createdAt: "desc" }, take: 12 },
        injuries: true,
        attendance: { take: 30, orderBy: { createdAt: "desc" } },
        user: { select: { id: true, username: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: safeLimit,
    });

    if (!athletes || athletes.length === 0) {
      logger.info(`[AI_SCOUT] No athletes found for the given filters.`);
      await job.updateProgress(100);
      return { success: true, candidates: [] };
    }

    const candidates: AthleteSummary[] = [];
    const total = athletes.length;
    let processed = 0;

    for (const a of athletes) {
      // update progress periodically
      processed++;
      if (processed % 10 === 0 || processed === total) {
        await job.updateProgress(Math.round((processed / total) * 80)); // up to 80% for processing
      }

      try {
        // compute recent performance average from performances (score fields)
        const perfScores = (a.performances || []).map((p) => Number(p.score)).filter((n) => !Number.isNaN(n));
        const avgScore = perfScores.length > 0 ? perfScores.reduce((s, v) => s + v, 0) / perfScores.length : null;

        // consistency: inverse of stdev normalized (higher is better)
        let consistency = null;
        if (perfScores.length >= 3) {
          const mean = avgScore!;
          const variance = perfScores.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / perfScores.length;
          const stdev = Math.sqrt(variance);
          // normalize: map stdev to [0,1] via heuristic (lower stdev -> closer to 1)
          consistency = Math.max(0, 1 - Math.min(1, stdev / Math.max(1, Math.abs(mean) || 1)));
        }

        // recent trend: compare last 3 vs previous 3 (if available)
        let recentTrend = null;
        if (perfScores.length >= 6) {
          const last3 = perfScores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
          const prev3 = perfScores.slice(3, 6).reduce((a, b) => a + b, 0) / 3;
          // positive means improvement (for metrics where lower is better, domain mapping may be required)
          recentTrend = last3 - prev3;
        } else if (perfScores.length >= 3) {
          // small fallback: compare last to average
          recentTrend = perfScores[0] - (avgScore ?? perfScores[0]);
        }

        // injury history: count and severity heuristic
        const injuryCount = (a.injuries || []).length;

        // attendance rate: present / total (if attendance records exist)
        let attendanceRate = null;
        if (a.attendance && a.attendance.length > 0) {
          const present = a.attendance.filter((att: any) => att.status === "present").length;
          attendanceRate = present / a.attendance.length;
        }

        // Simple normalized scoring using weights
        // Note: depending on sport, higher score could mean better; domain knowledge later
        let score = 0;
        if (avgScore !== null) score += (normalizedRange(avgScore) * (mergedWeights.recentPerformance || 0));
        if (consistency !== null) score += (consistency * (mergedWeights.consistency || 0));
        if (typeof injuryCount === "number") score += ((1 - Math.min(1, injuryCount / 5)) * (mergedWeights.injuryHistory || 0));
        if (recentTrend !== null) score += ((normalizeTrend(recentTrend)) * (mergedWeights.growthRate || 0));
        if (attendanceRate !== null) score += (attendanceRate * (mergedWeights.attendance || 0));

        // baseline mapping and clamp
        score = Number((score * 100).toFixed(2)); // scale to 0-100-ish

        // filter minimal assessment / perf counts if required
        const assessmentCount = (a.assessments || []).length;
        if (assessmentCount < minAssessments && perfScores.length < minAssessments) {
          // skip under-evaluated athletes
          continue;
        }

        const candidate: AthleteSummary = {
          athleteId: a.id,
          name: a.name,
          athleteCode: a.athleteCode,
          sport: a.sport,
          avgScore,
          consistency,
          recentTrend,
          injuryCount,
          attendanceRate,
          raw: {
            user: a.user,
            performances: a.performances,
            assessments: a.assessments,
            injuries: a.injuries,
            attendance: a.attendance,
          },
          score,
        };

        candidates.push(candidate);
      } catch (innerErr: any) {
        logger.error(`[AI_SCOUT] Error analyzing athlete ${a.id}: ${innerErr?.message || innerErr}`);
        // continue analyzing others — don't fail the whole job
      }
    }

    // Step 2: Rank candidates by score (desc)
    candidates.sort((x, y) => (y.score || 0) - (x.score || 0));

    // Step 3: Optional AI enrichment to provide human-friendly reason strings for top N
    const topN = Math.min(10, candidates.length);
    const topCandidates = candidates.slice(0, topN);

    const aiEnrichPromises = topCandidates.map(async (c, idx) => {
      try {
        const aiPayload = {
          athlete: {
            id: c.athleteId,
            name: c.name,
            athleteCode: c.athleteCode,
            sport: c.sport,
          },
          metrics: {
            avgScore: c.avgScore,
            consistency: c.consistency,
            recentTrend: c.recentTrend,
            injuryCount: c.injuryCount,
            attendanceRate: c.attendanceRate,
            score: c.score,
          },
          goal,
        };

        // Use safeAIInvoke — wraps LLM call, handles throttling/fallback
        const summary = await safeAIInvoke(async (aiClient) => {
          // aiClient is an optional adapter — if not available, fallback returns null
          // The actual aiUtils.safeAIInvoke should accept a function that receives an adapter (or nothing)
          const prompt = `You are a sports scout assistant. Provide a concise one-line recommendation (max 30 words) pointing why athlete ${aiPayload.athlete.name} is a top prospect, using the provided metrics. Be actionable and objective.`;

          // Suppose safeAIInvoke will call underlying LLM and return a text.
          const aiText: any = await aiClient?.summarize?.(prompt, { meta: aiPayload }) ?? null;
          return aiText ?? null;
        });

        c.reason = typeof summary === "string" ? summary : heuristicReason(c);
      } catch (err) {
        logger.warn(`[AI_SCOUT] AI enrichment failed for ${c.athleteId} — falling back to heuristic reason.`);
        c.reason = heuristicReason(c);
      }
      await job.updateProgress(80 + Math.round((idx / topN) * 15)); // finalizing enrichment
    });

    await Promise.all(aiEnrichPromises);

    // Step 4: Return top recommendations + metadata
    const recommendations = candidates.map((c) => ({
      athleteId: c.athleteId,
      name: c.name,
      athleteCode: c.athleteCode,
      sport: c.sport,
      score: c.score,
      reason: c.reason,
    }));

    await job.updateProgress(100);

    logger.info(`[AI_SCOUT] Completed job ${job.id} — returning ${recommendations.length} candidates`);
    return { success: true, candidates: recommendations, meta: { scanned: athletes.length } };
  } catch (err: any) {
    logger.error(`[AI_SCOUT] Job ${job.id} failed: ${err?.message || err}`);
    throw Errors.Server("AI scout processing failed");
  }
}

/**
 * Helpers
 */

/**
 * Normalizes a numeric metric to rough 0..1 range.
 * This is heuristic — real mapping should be sport-specific and configurable.
 */
function normalizedRange(n: number | null | undefined) {
  if (n === null || typeof n === "undefined" || Number.isNaN(Number(n))) return 0.5;
  // Map using logistic-ish transform with domain assumptions
  const v = Number(n);
  // if metric tends to be lower-is-better (e.g., time), callers must invert before passing
  const normalized = 1 / (1 + Math.exp(-(v / Math.max(1, Math.abs(v) || 1)) / 10));
  return Math.min(1, Math.max(0, normalized));
}

/**
 * Normalize trend (small positive improvements should be rewarded)
 */
function normalizeTrend(t: number | null | undefined) {
  if (t === null || typeof t === "undefined" || Number.isNaN(Number(t))) return 0;
  // small trends mapped to -1..1
  const val = Number(t);
  return Math.tanh(val / 10); // smooth mapping
}

/**
 * Fallback heuristic reason if AI enrichment is unavailable
 */
function heuristicReason(c: AthleteSummary) {
  const parts: string[] = [];
  if (c.avgScore != null) parts.push(`Avg: ${Number(c.avgScore).toFixed(2)}`);
  if (c.consistency != null) parts.push(`Consistency: ${(c.consistency * 100).toFixed(0)}%`);
  if (c.recentTrend != null) parts.push(`Trend: ${Number(c.recentTrend).toFixed(2)}`);
  if (c.attendanceRate != null) parts.push(`Attendance: ${(c.attendanceRate * 100).toFixed(0)}%`);
  if (c.injuryCount != null && c.injuryCount > 0) parts.push(`Injuries: ${c.injuryCount}`);
  return parts.join(" • ");
}