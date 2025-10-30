/**
 * aiSleepAnalysis.worker.ts
 * --------------------------------------------------------------------
 * AI Sleep & Recovery Analysis Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Collect recent sessions, training load, self-reported sleep notes/messages
 *  - Compute simple recovery/sleep metrics (avg session time, training frequency)
 *  - Use safe AI wrapper to generate personalized sleep/recovery recommendations
 *  - Store a non-sensitive summary resource and optionally notify coach
 *
 * Safety / Production considerations:
 *  - Uses time-bounded AI invocation with fallback text
 *  - Handles missing data gracefully
 *  - Rate-limited/logged to avoid abuse
 *  - Writes a Resource with visibility = institution
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { safeAIInvoke } from "../../utils/aiUtils";
import { initNotificationForCoach } from "../../workers/ai/workerUtils";

type Payload = {
  athleteId: string;
  lookbackDays?: number; // how many days to analyze (default 14)
};

export default async function (job: Job<Payload>) {
  const { athleteId, lookbackDays = 14 } = job.data;
  logger.info(`[AI_SLEEP] Starting sleep analysis for athlete=${athleteId} (days=${lookbackDays})`);

  try {
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    // 1) Fetch athlete, sessions, messages (sleep notes)
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        sessions: {
          where: { date: { gte: since } },
          select: { date: true, duration: true, notes: true },
          orderBy: { date: "desc" },
        },
        performances: {
          where: { date: { gte: since } },
          select: { date: true, score: true, assessmentType: true },
        },
        messages: {
          where: { createdAt: { gte: since } },
          select: { content: true, createdAt: true, senderId: true },
        },
      },
    });

    if (!athlete) throw Errors.NotFound("Athlete not found");

    // 2) Basic computed metrics
    const sessionCount = athlete.sessions.length;
    const avgDuration =
      sessionCount > 0 ? athlete.sessions.reduce((s, x) => s + (x.duration || 0), 0) / sessionCount : 0;

    // Estimate training load: simple proxy = sum(duration) * intensity factor (unknown) -> use duration
    const totalDuration = athlete.sessions.reduce((s, x) => s + (x.duration || 0), 0);

    // Extract sleep-related self-reports from messages / notes
    const sleepTexts: string[] = [];
    athlete.sessions.forEach((s) => {
      if (s.notes) sleepTexts.push(s.notes);
    });
    athlete.messages.forEach((m) => {
      if (/sleep|tired|insomnia|rest|rested|fatig/i.test(m.content)) sleepTexts.push(m.content);
    });
    const sleepTextDump = sleepTexts.join("\n").slice(0, 2000); // trim for prompt safety

    // 3) Heuristics to decide if risk present
    const riskFlags: string[] = [];
    if (avgDuration > 90) riskFlags.push("high_average_session_duration");
    if (sessionCount >= 6) riskFlags.push("high_session_count");
    if (/insomnia|no sleep|can't sleep/i.test(sleepTextDump)) riskFlags.push("self_reported_insomnia");

    // 4) Ask the safe AI for a short actionable report (wrapped)
    let aiOutput: any = null;
    try {
      aiOutput = await safeAIInvoke(async (ai) => {
        const prompt = `
You are an expert sports recovery assistant. Given the data below, produce:
1) a short athlete-facing sleep & recovery summary (max 40 words),
2) 3 concise coach-facing recommendations (bullet lines),
3) a simple recovery score from 0-100.

Data:
- Athlete name: ${athlete.user?.name ?? "Unknown"}
- Sessions (last ${lookbackDays} days): count=${sessionCount}, avg_duration=${avgDuration.toFixed(
          1
        )}min, total_duration=${totalDuration}min
- Self-reports / notes (trimmed): ${sleepTextDump || "none"}
- Flags: ${riskFlags.join(", ") || "none"}

Return JSON object with keys: athleteSummary, coachRecommendations (array), recoveryScore
        `;
        const resp = await ai?.complete?.(prompt, { maxTokens: 350 });
        // expect assistant to return JSON — safeAIInvoke will attempt to parse
        return resp;
      });
    } catch (err) {
      logger.warn("[AI_SLEEP] AI summary failed, using fallback");
    }

    // 5) Build fallback report if AI failed or returned invalid
    const fallback = {
      athleteSummary:
        aiOutput?.athleteSummary ??
        (riskFlags.length
          ? "Your recent training load looks high and sleep-related notes appear. Prioritize rest and short naps."
          : "Training and sleep patterns appear stable. Maintain consistent sleep schedule."),
      coachRecommendations:
        aiOutput?.coachRecommendations ??
        (riskFlags.length
          ? [
              "Reduce high-intensity sessions by 20% for 7 days",
              "Schedule structured sleep education and monitor sleep hours",
              "Check-in with athlete for mental/physical fatigue",
            ]
          : [
              "Monitor weekly training load",
              "Encourage consistent sleep routine",
              "Use quick self-report sleep check-ins after heavy sessions",
            ]),
      recoveryScore: Number(aiOutput?.recoveryScore ?? Math.max(40, 90 - sessionCount * 5 - Math.floor(avgDuration / 10))),
    };

    const report = {
      athleteId,
      generatedAt: new Date(),
      sessionCount,
      avgDuration,
      totalDuration,
      riskFlags,
      summary: fallback.athleteSummary,
      coachRecommendations: fallback.coachRecommendations,
      recoveryScore: fallback.recoveryScore,
    };

    // 6) Persist the report as a resource (non-sensitive)
    const saved = await prisma.resource.create({
      data: {
        uploaderId: "system",
        institutionId: athlete.institutionId ?? undefined,
        title: `Sleep & Recovery Report - ${athlete.user?.name ?? "Athlete"}`,
        description: JSON.stringify(report, null, 2),
        type: "sleep_recovery_report",
        visibility: "institution",
      },
    });

    // 7) Optionally schedule/trigger a notification to coach if risk flags present
    if (riskFlags.length > 0 && athlete.institutionId) {
      try {
        await initNotificationForCoach({
          athleteId,
          institutionId: athlete.institutionId,
          athleteName: athlete.user?.name || "Athlete",
          reason: "sleep_recovery_risk",
          payload: { reportId: saved.id, riskFlags },
        });
      } catch (notifyErr) {
        logger.warn("[AI_SLEEP] Failed to enqueue coach notification:", (notifyErr as Error).message);
      }
    }

    logger.info(`[AI_SLEEP] ✅ Completed sleep analysis for athlete=${athleteId}`);
    return { success: true, report, resourceId: saved.id };
  } catch (err: any) {
    logger.error(`[AI_SLEEP] ❌ Error: ${err.message}`);
    // Throw ApiError so worker system can retry according to job settings
    throw Errors.Server("Sleep analysis failed");
  }
}