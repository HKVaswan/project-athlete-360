/**
 * src/workers/ai/aiCoach.worker.ts
 * ------------------------------------------------------------------------
 * AI Coach Worker (Enterprise Grade)
 *
 * Responsibilities:
 *  - Generate athlete-specific training insights and micro-plans
 *  - Summarize session/assessment/performance trends
 *  - Create data-driven recommendations (recovery, load, intensity)
 *  - Persist AI insights to DB (if aiInsight table exists)
 *  - Enqueue notifications so coaches/athletes can be alerted
 *
 * Design goals:
 *  - Safe to run without an AI provider (fallback heuristics)
 *  - Idempotent where possible
 *  - Robust error handling & alerting
 *  - Config-driven (OPENAI_API_KEY, AI_PROVIDER_URL, etc.)
 */

import { Job } from "bullmq";
import axios from "axios";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { config } from "../../config";
import { queues } from "../index";
import os from "os";

type AiJobPayload =
  | {
      type: "generateInsightForAthlete";
      athleteId: string;
      contextWindowHours?: number;
      force?: boolean;
    }
  | {
      type: "summarizeSession";
      sessionId: string;
      maxTokens?: number;
    }
  | {
      type: "batchGenerateInsights";
      athleteIds: string[];
    };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || config.openaiKey;
const AI_PROVIDER_URL = process.env.AI_PROVIDER_URL || config.aiProviderUrl || "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-4o-mini"; // placeholder; adapt as needed

// Time window (hours) default when building context for athlete
const DEFAULT_CONTEXT_HOURS = Number(process.env.AI_CONTEXT_HOURS || 168); // 7 days

// Minimal prompt safety guard
const MAX_PROMPT_TOKENS = 3000;

// Graceful call to AI provider (OpenAI-compatible)
async function callAiProvider(prompt: string, opts?: { maxTokens?: number }) {
  if (!OPENAI_API_KEY) {
    throw new Error("AI provider not configured (OPENAI_API_KEY missing)");
  }

  try {
    const resp = await axios.post(
      AI_PROVIDER_URL,
      {
        model: DEFAULT_MODEL,
        messages: [{ role: "system", content: "You are an expert sports performance analyst and coach." }, { role: "user", content: prompt }],
        max_tokens: opts?.maxTokens ?? 600,
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      }
    );

    // Attempt to read assistant content (OpenAI v1 shape)
    const content =
      resp?.data?.choices?.[0]?.message?.content ??
      resp?.data?.choices?.[0]?.text ??
      JSON.stringify(resp?.data);
    return String(content).trim();
  } catch (err: any) {
    logger.error(`[AI COACH] AI provider call failed: ${err?.message ?? err}`);
    throw err;
  }
}

/**
 * Fallback heuristic: if no AI provider configured, derive simple insights
 * from numeric trends (improving/worsening / inconsistent data).
 */
function heuristicInsightBuilder(athlete: any, performances: any[], injuries: any[], assessments: any[]) {
  // Basic trend detection for a few metrics
  const insightParts: string[] = [];

  if (!performances || performances.length === 0) {
    insightParts.push("No recent performance records found. Recommend baseline testing.");
  } else {
    // group by assessmentType and check last 3 values
    const byType: Record<string, number[]> = {};
    for (const p of performances) {
      byType[p.assessmentType] = byType[p.assessmentType] || [];
      byType[p.assessmentType].push(Number(p.score));
    }
    for (const k of Object.keys(byType)) {
      const arr = byType[k].slice(-3);
      if (arr.length >= 2) {
        const first = arr[0], last = arr[arr.length - 1];
        if (last > first) insightParts.push(`For ${k}, score increased from ${first} → ${last} (trend: improving).`);
        else if (last < first) insightParts.push(`For ${k}, score decreased from ${first} → ${last} (trend: decline) — check load/recovery.`);
        else insightParts.push(`For ${k}, performance stable across recent tests.`);
      } else {
        insightParts.push(`Insufficient recent values for ${k} to detect trend.`);
      }
    }
  }

  if (injuries && injuries.length > 0) {
    insightParts.push(`Recent injuries recorded: ${injuries.map((i: any) => i.description).slice(0, 3).join("; ")}. Consider conservative load management.`);
  }

  // Use assessments summary
  if (assessments && assessments.length > 0) {
    insightParts.push(`Assessments available: ${assessments.map((a: any) => a.metric).slice(0, 5).join(", ")}. Consider targeted strength & mobility work.`);
  }

  insightParts.push("Suggested short-term plan: 2 weeks focused micro-cycle with recovery emphasis and one high-quality speed/power session per week.");

  return insightParts.join("\n");
}

/**
 * Persist insight into DB table `aiInsight` (if exists).
 * Schema suggestion (not required here): aiInsight { id, athleteId?, sessionId?, type, content, source, createdAt }
 */
async function persistAiInsight(payload: {
  athleteId?: string;
  sessionId?: string;
  type: string;
  content: string;
  source?: string;
}) {
  const anyPrisma: any = prisma as any;
  if (typeof anyPrisma.aiInsight?.create !== "function") {
    // DB table not present — just log
    logger.debug("[AI COACH] aiInsight table not present; skipping persist.");
    return null;
  }

  try {
    const rec = await anyPrisma.aiInsight.create({
      data: {
        athleteId: payload.athleteId ?? null,
        sessionId: payload.sessionId ?? null,
        type: payload.type,
        content: payload.content,
        source: payload.source ?? "aiCoach.worker",
      },
    });
    return rec;
  } catch (err: any) {
    logger.warn("[AI COACH] Persist aiInsight failed: " + err.message);
    return null;
  }
}

/**
 * Create a notification for coach/athlete about new insight
 */
async function notifyUser(userId: string, title: string, message: string) {
  try {
    const q = queues["notifications"];
    if (q) {
      await q.add(
        "aiInsightNotification",
        { userId, title, message },
        { removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 2000 } }
      );
      logger.info(`[AI COACH] Notification queued for user ${userId}`);
    } else {
      // fallback: create a message record
      if (userId) {
        await prisma.message.create({
          data: { senderId: null as any, receiverId: userId, title, content: message },
        });
        logger.info(`[AI COACH] Message created for user ${userId}`);
      }
    }
  } catch (err: any) {
    logger.warn(`[AI COACH] Failed to notify user ${userId}: ${err.message}`);
  }
}

/**
 * Build the context for an athlete: latest performances, assessments, injuries, sessions
 */
async function buildAthleteContext(athleteId: string, hours = DEFAULT_CONTEXT_HOURS) {
  // Pull recent relevant data
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const [athlete, performances, assessments, injuries, recentSessions] = await Promise.all([
    prisma.athlete.findUnique({ where: { id: athleteId }, include: { user: true, institution: true } }),
    prisma.performance.findMany({ where: { athleteId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.assessment.findMany({ where: { athleteId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    prisma.injury.findMany({ where: { athleteId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.session.findMany({ where: { athletes: { some: { id: athleteId } }, date: { gte: since } }, orderBy: { date: "desc" }, take: 5 }),
  ]);

  return { athlete, performances, assessments, injuries, recentSessions };
}

/**
 * Main processor function for worker jobs
 */
export default async function (job: Job) {
  logger.info(`[AI COACH] Running job ${job.id} - type=${job.name || (job.data as any).type}`);
  const payload = job.data as AiJobPayload;

  try {
    if (payload.type === "generateInsightForAthlete") {
      const { athleteId, contextWindowHours = DEFAULT_CONTEXT_HOURS, force = false } = payload;

      // Avoid duplicate runs if not forced and recent insight exists (idempotency)
      if (!force) {
        const anyPrisma: any = prisma as any;
        if (typeof anyPrisma.aiInsight?.findFirst === "function") {
          const recent = await anyPrisma.aiInsight.findFirst({
            where: { athleteId, createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60) } }, // 1 hour
          });
          if (recent) {
            logger.info(`[AI COACH] Recent insight exists for ${athleteId}; skipping (force=false)`);
            return recent;
          }
        }
      }

      const ctx = await buildAthleteContext(athleteId, contextWindowHours);

      // Compose a prompt for AI provider if available
      const promptParts: string[] = [];
      promptParts.push(`Athlete profile: ${ctx.athlete?.name ?? "N/A"} (${ctx.athlete?.sport ?? "N/A"})`);
      promptParts.push(`Recent performances (last ${contextWindowHours} hours):`);
      (ctx.performances || []).slice(-20).forEach((p: any) => {
        promptParts.push(`- ${p.assessmentType}: ${p.score} (date: ${p.date?.toISOString?.() ?? p.date})`);
      });
      promptParts.push(`Recent injuries (if any):`);
      (ctx.injuries || []).forEach((i: any) => {
        promptParts.push(`- ${i.description} (date: ${i.date?.toISOString?.()}) severity: ${i.severity}`);
      });
      promptParts.push(`Recent assessments:`);
      (ctx.assessments || []).slice(-20).forEach((a: any) => {
        promptParts.push(`- ${a.metric}: ${a.valueText ?? a.valueNumber}`);
      });

      promptParts.push("");
      promptParts.push("Provide succinct, actionable insights for the athlete (max 250 words):");
      promptParts.push("- 1-2 bullet short-term training recommendations (2 weeks).");
      promptParts.push("- 1 recovery recommendation if injury risk or recent injuries found.");
      promptParts.push("- 1 measurable target to track next session.");

      const prompt = promptParts.join("\n").slice(0, MAX_PROMPT_TOKENS);

      let aiContent: string;
      let source = "heuristic";
      if (OPENAI_API_KEY) {
        try {
          aiContent = await callAiProvider(prompt, { maxTokens: 600 });
          source = "openai";
        } catch (err) {
          logger.warn("[AI COACH] AI provider failed, falling back to heuristic");
          aiContent = heuristicInsightBuilder(ctx.athlete, ctx.performances, ctx.injuries, ctx.assessments);
        }
      } else {
        aiContent = heuristicInsightBuilder(ctx.athlete, ctx.performances, ctx.injuries, ctx.assessments);
      }

      // Persist insight if table exists
      await persistAiInsight({ athleteId, type: "athlete_insight", content: aiContent, source });

      // Notify athlete's coach and athlete's user record (if available)
      const coach = await prisma.coachInstitution.findFirst({
        where: { institutionId: ctx.athlete?.institutionId },
        include: { coach: true },
      });

      // notify athlete user
      if (ctx.athlete?.userId) {
        await notifyUser(ctx.athlete.userId, "New training insight available", aiContent);
      }

      // notify coach (if found)
      if (coach?.coach?.id) {
        await notifyUser(coach.coach.id, `AI insight for ${ctx.athlete?.name}`, aiContent);
      }

      logger.info(`[AI COACH] Insight generated for athlete ${athleteId}`);
      return { athleteId, insight: aiContent, source };
    }

    // Summarize session (single session)
    if (payload.type === "summarizeSession") {
      const { sessionId, maxTokens = 400 } = payload;
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { athletes: true, assessments: true },
      });
      if (!session) throw new Error("Session not found");

      const parts: string[] = [];
      parts.push(`Session: ${session.name} on ${session.date?.toISOString?.()}`);
      parts.push(`Athletes: ${session.athletes?.map((a: any) => a.name).slice(0, 10).join(", ")}`);
      parts.push("Key assessments:");
      (session.assessments || []).slice(0, 30).forEach((a: any) => {
        parts.push(`- ${a.metric}: ${a.valueText ?? a.valueNumber}`);
      });

      const prompt = parts.join("\n") + "\n\nProvide a concise session summary (3-6 bullets) with coaching recommendations.";

      let summary: string;
      try {
        if (OPENAI_API_KEY) {
          summary = await callAiProvider(prompt, { maxTokens });
        } else {
          // lightweight summary fallback
          summary = `Session summary for ${session.name}. Athletes: ${session.athletes?.length}. Key observations: ${session.assessments?.length} assessments recorded. Recommend focusing on technique and appropriate recovery.`;
        }
      } catch (err) {
        logger.warn("[AI COACH] Session summary AI call failed; using fallback");
        summary = `Session summary fallback: ${session.name} — ${session.athletes?.length} athletes.`;
      }

      await persistAiInsight({ sessionId, type: "session_summary", content: summary, source: OPENAI_API_KEY ? "openai" : "heuristic" });

      // notify coach(s)
      if (session.coachId) {
        await notifyUser(session.coachId, `Session summary: ${session.name}`, summary);
      }

      return { sessionId, summary };
    }

    // Batch generate insights (iterate safely)
    if (payload.type === "batchGenerateInsights") {
      const results: any[] = [];
      for (const aid of payload.athleteIds) {
        try {
          const r = await (exports as any).default?.({ data: { type: "generateInsightForAthlete", athleteId: aid } } as any); // not ideal but keep compatibility
          results.push({ athleteId: aid, ok: true, result: r });
        } catch (err: any) {
          logger.error(`[AI COACH] batchGenerateInsights: failed for ${aid}: ${err.message}`);
          results.push({ athleteId: aid, ok: false, error: err.message });
        }
      }
      return results;
    }

    logger.warn(`[AI COACH] Unknown job payload type: ${(job.data as any).type}`);
    return null;
  } catch (err: any) {
    logger.error(`[AI COACH] Job ${job.id} failed: ${err?.message ?? err}`);
    // push error to monitoring / alert queue
    try {
      const q = queues["errorMonitor"];
      if (q) {
        await q.add("aiCoachError", { jobId: job.id, error: err?.message ?? String(err), host: os.hostname() }, { removeOnComplete: true });
      }
    } catch (qErr) {
      logger.warn("[AI COACH] Failed to enqueue errorMonitor job: " + (qErr as any).message);
    }
    throw err;
  }
}