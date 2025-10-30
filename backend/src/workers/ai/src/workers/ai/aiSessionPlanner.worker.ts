/**
 * src/workers/ai/aiSessionPlanner.worker.ts
 *
 * Enterprise-grade AI Session Planner Worker (rule-based core).
 *
 * Responsibilities:
 *  - For each athlete (or a list of athletes), gather recent sessions, assessments (wellness),
 *    recovery, upcoming competitions and injuries.
 *  - Produce a short-term session plan (default: 7 days) with load adjustments:
 *      · Reduce load when recovery is poor / injury risk high
 *      · Maintain or slightly increase load when recovery is good and no imminent competition
 *      · Introduce tapering before competition
 *  - Persist suggested sessions into DB (Session entries with tag `planned_by_ai`)
 *  - Optionally notify coach/admin via queue
 *
 * Notes:
 *  - The algorithm is intentionally conservative and transparent (explainable).
 *  - Later we can swap computePlan(...) with an ML model or external AI API.
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";

// configuration defaults (can later live in config module)
const DEFAULT_HORIZON_DAYS = 7;
const DEFAULT_BASE_DURATION = 60; // minutes
const MIN_DURATION = 20;
const MAX_DURATION = 180;

/**
 * Compute per-day load multiplier based on inputs.
 * output range: 0.3 (light) ... 1.3 (hard)
 */
const computeLoadMultiplier = (opts: {
  recoveryScore: number; // 0-100
  fatigue: number; // 0-100 (higher means more fatigued)
  upcomingCompetitionDays?: number | null; // days until competition, null if none
  recentTrend?: "improving" | "stable" | "declining";
  injuryRiskScore?: number; // 0-100
}) => {
  const { recoveryScore, fatigue, upcomingCompetitionDays, recentTrend, injuryRiskScore } = opts;

  // start from baseline multiplier
  let m = 1.0;

  // recovery effect: scale between 0.6..1.15
  const recoveryFactor = 0.6 + (Math.min(Math.max(recoveryScore, 0), 100) / 100) * 0.55;
  m *= recoveryFactor;

  // fatigue reduces load (0.5..1)
  const fatigueFactor = 1 - Math.min(Math.max(fatigue, 0), 100) / 200; // fatigue 100 -> 0.5
  m *= fatigueFactor;

  // injury risk: strong reduction if high (risk 0..100)
  if (typeof injuryRiskScore === "number") {
    const risk = Math.min(Math.max(injuryRiskScore, 0), 100);
    if (risk >= 75) m *= 0.5;
    else if (risk >= 50) m *= 0.75;
  }

  // trending improvements: allow slight increase
  if (recentTrend === "improving") m *= 1.05;
  if (recentTrend === "declining") m *= 0.95;

  // competition tapering: reduce load in last 2-3 days
  if (typeof upcomingCompetitionDays === "number" && upcomingCompetitionDays >= 0) {
    if (upcomingCompetitionDays <= 2) m *= 0.55; // heavy taper
    else if (upcomingCompetitionDays <= 5) m *= 0.8; // mild taper
    else if (upcomingCompetitionDays <= 10) m *= 0.95;
  }

  // clamp multiplier
  m = Math.max(0.3, Math.min(1.3, m));
  return parseFloat(m.toFixed(3));
};

/**
 * Build a day-by-day session suggestion for horizonDays
 */
const buildPlanForAthlete = (athleteId: string, horizonDays: number, baseDuration: number, modelInputs: any) => {
  const plan: Array<{
    date: string;
    title: string;
    duration: number;
    intensity: "low" | "moderate" | "high";
    notes: string;
    tag?: string;
  }> = [];

  const today = new Date();
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    // compute dynamic multiplier per day (we allow tapering if competition is within horizon)
    const upcomingCompetitionDays = modelInputs.nextCompetitionInDays;
    const multiplier = computeLoadMultiplier({
      recoveryScore: modelInputs.recoveryScore,
      fatigue: modelInputs.fatigue,
      upcomingCompetitionDays:
        upcomingCompetitionDays !== null ? upcomingCompetitionDays - i : null,
      recentTrend: modelInputs.recentTrend,
      injuryRiskScore: modelInputs.injuryRiskScore,
    });

    let duration = Math.round(baseDuration * multiplier);
    duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));

    // determine intensity label from multiplier
    const intensity = multiplier >= 1.1 ? "high" : multiplier >= 0.8 ? "moderate" : "low";

    const notes = JSON.stringify({
      plannedBy: "aiSessionPlanner",
      multiplier,
      baseDuration,
      inputs: modelInputs,
    });

    plan.push({
      date: d.toISOString().split("T")[0],
      title:
        i === 0 ? "AI: Today's Plan" : i === horizonDays - 1 ? "AI: Final Day Plan" : `AI Plan Day ${i + 1}`,
      duration,
      intensity,
      notes,
      tag: "planned_by_ai",
    });
  }

  return plan;
};

/**
 * Gather athlete inputs required by planner.
 * Conservative defaults used when data missing.
 */
const collectModelInputs = async (athleteId: string) => {
  // fetch latest wellness assessment (if present), recent sessions summary, next competition and injury risk if present
  const [wellness, recentSessions, nextCompetition, aiRisk] = await Promise.all([
    prisma.assessment.findFirst({
      where: { athleteId, metric: { in: ["wellness", "recovery", "fatigue", "sleep"] } },
      orderBy: { createdAt: "desc" },
      select: { valueNumber: true, valueText: true, createdAt: true, metric: true },
    }),
    prisma.session.findMany({
      where: { athletes: { some: { id: athleteId } } },
      orderBy: { date: "desc" },
      take: 10,
      select: { duration: true, notes: true, date: true, name: true },
    }),
    prisma.athleteCompetition.findFirst({
      where: { athleteId },
      include: { competition: true },
      orderBy: { createdAt: "asc" }, // earliest upcoming is likely first (we'll filter)
    }),
    prisma.aiInjuryRisk.findUnique({ where: { athleteId } }).catch(() => null),
  ]).catch((e) => {
    logger.warn(`[AI:SessionPlanner] Data collection warning for athlete ${athleteId}: ${e?.message || e}`);
    return [null, [], null, null];
  });

  // compute aggregated recent load (simple)
  const totalRecentLoad = (recentSessions || []).reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
  const avgRecentDuration = (recentSessions && recentSessions.length > 0) ? Math.round(totalRecentLoad / recentSessions.length) : DEFAULT_BASE_DURATION;

  // basic recovery & fatigue inference from available wellness metric
  // fallback sensible defaults
  let recoveryScore = 75;
  let fatigue = 30;
  if (wellness) {
    // if numeric, use it as recovery; if textual try to parse
    if (typeof wellness.valueNumber === "number") {
      recoveryScore = Math.min(100, Math.max(0, Math.round(wellness.valueNumber)));
      fatigue = Math.max(0, 100 - recoveryScore);
    } else if (typeof wellness.valueText === "string") {
      // try lightweight parse: look for numbers or known keywords
      const num = parseFloat(wellness.valueText);
      if (!Number.isNaN(num)) {
        recoveryScore = Math.min(100, Math.max(0, Math.round(num)));
        fatigue = Math.max(0, 100 - recoveryScore);
      }
    }
  }

  // upcoming competition days
  let nextCompetitionInDays: number | null = null;
  if (nextCompetition && nextCompetition.competition && nextCompetition.competition.startDate) {
    const start = new Date(nextCompetition.competition.startDate);
    const diffMs = start.getTime() - Date.now();
    nextCompetitionInDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (nextCompetitionInDays < 0) nextCompetitionInDays = null;
  }

  // simple recent trend detection: compare last 3 sessions durations
  let recentTrend: "improving" | "stable" | "declining" = "stable";
  if (recentSessions && recentSessions.length >= 3) {
    const last3 = recentSessions.slice(0, 3).map((s: any) => s.duration || 0);
    const diff = last3[0] - last3[2];
    if (diff > 8) recentTrend = "improving";
    else if (diff < -8) recentTrend = "declining";
  }

  const injuryRiskScore = aiRisk?.riskScore ?? 0;

  return {
    recoveryScore,
    fatigue,
    avgRecentDuration,
    nextCompetitionInDays,
    recentTrend,
    injuryRiskScore,
  };
};

/**
 * Persist plan items as tentative Session rows tagged `planned_by_ai`.
 * NOTE: We create session entries with `notes` containing metadata so coaches can review & accept/edit.
 * We set coachId to NULL (coach will be notified to accept) and set institutionId if athlete belongs to one.
 */
const persistPlan = async (athlete: { id: string; institutionId?: string | null; userId?: string | null }, plan: Array<any>) => {
  const created: any[] = [];

  for (const item of plan) {
    // create session date at midday local time for convenience
    const date = new Date(item.date + "T10:00:00.000Z");

    try {
      const session = await prisma.session.create({
        data: {
          name: item.title,
          date,
          duration: item.duration,
          notes: item.notes,
          institutionId: athlete.institutionId ?? undefined,
          // store relation with athlete via attendance join (so athlete appears in session)
          athletes: { connect: [{ id: athlete.id }] },
        },
      });
      created.push(session);
    } catch (err: any) {
      // If duplicate or constraint occurs, log and continue
      logger.warn(`[AI:SessionPlanner] Could not persist planned session for ${athlete.id} on ${item.date}: ${err.message}`);
    }
  }

  return created;
};

/**
 * Worker main function
 * Job.data shape: { athleteIds?: string[], horizonDays?: number, triggeredBy?: string }
 */
export default async function (job: Job<{ athleteIds?: string[]; horizonDays?: number; triggeredBy?: string }>) {
  const { athleteIds, horizonDays = DEFAULT_HORIZON_DAYS, triggeredBy = "cron" } = job.data;
  const start = Date.now();
  logger.info(`[AI:SessionPlanner] Starting planning (horizon=${horizonDays}) triggeredBy=${triggeredBy}`);

  try {
    // fetch athletes to plan for
    const athletes = athleteIds && athleteIds.length > 0
      ? await prisma.athlete.findMany({ where: { id: { in: athleteIds } }, include: { user: true } })
      : await prisma.athlete.findMany({ include: { user: true } });

    let totalCreated = 0;

    for (const athlete of athletes) {
      try {
        const inputs = await collectModelInputs(athlete.id);
        const baseDuration = inputs.avgRecentDuration || DEFAULT_BASE_DURATION;

        const modelInputs = {
          recoveryScore: inputs.recoveryScore,
          fatigue: inputs.fatigue,
          nextCompetitionInDays: inputs.nextCompetitionInDays,
          recentTrend: inputs.recentTrend,
          injuryRiskScore: inputs.injuryRiskScore,
        };

        const plan = buildPlanForAthlete(athlete.id, horizonDays, baseDuration, modelInputs);

        const created = await persistPlan(athlete, plan);
        totalCreated += created.length;

        // Notify coach / admin (if queue available)
        const notifyPayload = {
          type: "aiSessionPlan",
          athleteId: athlete.id,
          athleteName: athlete.name,
          createdCount: created.length,
          message: `AI generated ${created.length} suggested sessions for ${athlete.name}. Review and confirm.`,
        };

        // prefer coach notification via coach institution mapping; fallback to athlete's user id
        try {
          if (queues["notification"]) {
            await queues["notification"].add("aiSessionPlanNotify", notifyPayload, { removeOnComplete: true });
          }
        } catch (qErr) {
          logger.warn(`[AI:SessionPlanner] Notification enqueue failed for athlete ${athlete.id}: ${qErr?.message || qErr}`);
        }

        logger.info(`[AI:SessionPlanner] Plan created for athlete ${athlete.id}: ${created.length} sessions`);
      } catch (aErr: any) {
        logger.error(`[AI:SessionPlanner] Failed planning for athlete ${athlete.id}: ${aErr?.message || aErr}`);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.info(`[AI:SessionPlanner] Completed. athletes=${athletes.length} createdSessions=${totalCreated} time=${elapsed}s`);

    return { success: true, athletes: athletes.length, created: totalCreated };
  } catch (err: any) {
    logger.error(`[AI:SessionPlanner] Fatal error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
}