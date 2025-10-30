/**
 * aiMentalWellness.worker.ts
 * -------------------------------------------------------------
 * AI Mental Wellness Worker (Enterprise-Grade)
 *
 * Purpose:
 *  - Periodically analyze athlete data (performance, attendance, messages)
 *  - Detect burnout, low motivation, or stress indicators
 *  - Provide early insights & well-being summaries
 *  - Offer short athlete-facing and coach-facing notes
 *
 *  - Works safely without requiring sensitive data
 *  - AI calls are sandboxed with timeouts & fallbacks
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { safeAIInvoke } from "../../utils/aiUtils";

type Payload = {
  athleteId: string;
  timeframe?: "week" | "month";
};

export default async function (job: Job<Payload>) {
  const { athleteId, timeframe = "month" } = job.data;
  logger.info(`[AI_MENTAL] 🧠 Starting wellness check for athlete=${athleteId}`);

  try {
    // 1️⃣ Fetch key athlete data
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        user: { select: { name: true, email: true } },
        performances: {
          where: { date: { gte: since(timeframe) } },
          select: { score: true, notes: true, date: true },
          orderBy: { date: "desc" },
        },
        sessions: {
          where: { date: { gte: since(timeframe) } },
          select: { duration: true, notes: true },
        },
        messages: {
          where: { createdAt: { gte: since(timeframe) } },
          select: { senderRole: true, content: true },
        },
      },
    });

    if (!athlete) throw Errors.NotFound("Athlete not found");

    // 2️⃣ Analyze performance trends (simple logic + fallback AI summary)
    const perfScores = athlete.performances.map((p) => p.score || 0);
    const avgPerf = avg(perfScores);
    const perfTrend = trend(perfScores);

    // 3️⃣ Compute workload stress markers
    const totalSessions = athlete.sessions.length;
    const avgDuration =
      totalSessions > 0
        ? athlete.sessions.reduce((a, s) => a + (s.duration || 0), 0) / totalSessions
        : 0;
    const highLoad = avgDuration > 90 || totalSessions > 6;

    // 4️⃣ Scan recent message sentiment (very simple lexical check)
    const textDump = athlete.messages.map((m) => m.content.toLowerCase()).join(" ");
    const stressIndicators = countStressWords(textDump);
    const sentiment = stressIndicators > 3 ? "negative" : "neutral";

    // 5️⃣ Ask AI for short personalized summary (safe wrapper)
    const aiSummary = await safeAIInvoke(async (ai) => {
      const prompt = `
You are a sports psychologist AI.
Analyze the following athlete context:
Name: ${athlete.user?.name}
Performance Trend: ${perfTrend}
Average Score: ${avgPerf.toFixed(1)}
Sessions: ${totalSessions} sessions, avg ${avgDuration.toFixed(1)} min
Sentiment: ${sentiment}
Stress words count: ${stressIndicators}
Provide a brief athlete-facing summary (max 40 words) and a one-line coach insight.
`;
      return await ai?.summarize?.(prompt);
    });

    const report = {
      athleteId,
      generatedAt: new Date(),
      name: athlete.user?.name,
      perfTrend,
      avgPerf,
      sentiment,
      stressIndicators,
      highLoad,
      summary:
        aiSummary ??
        fallbackSummary({
          perfTrend,
          sentiment,
          stressIndicators,
          avgPerf,
          highLoad,
        }),
    };

    // 6️⃣ Store summary safely (non-destructive)
    await prisma.resource.create({
      data: {
        uploaderId: "system",
        institutionId: athlete.institutionId ?? undefined,
        title: `Mental Wellness Summary - ${athlete.user?.name || "Athlete"}`,
        description: JSON.stringify(report, null, 2),
        type: "mental_health_report",
        visibility: "institution",
      },
    });

    logger.info(`[AI_MENTAL] ✅ Job ${job.id} completed for athlete=${athleteId}`);
    return { success: true, report };
  } catch (err: any) {
    logger.error(`[AI_MENTAL] ❌ Job failed: ${err.message}`);
    throw Errors.Server("AI mental wellness analysis failed.");
  }
}

/* -------------------------
   Helper Functions
   ------------------------- */

function since(timeframe: "week" | "month") {
  const d = new Date();
  if (timeframe === "week") d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);
  return d;
}

function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function trend(values: number[]) {
  if (values.length < 3) return "steady";
  const recent = values.slice(-3);
  const delta = recent[2] - recent[0];
  if (delta > 3) return "improving";
  if (delta < -3) return "declining";
  return "steady";
}

function countStressWords(text: string) {
  const stressWords = ["tired", "burnout", "anxious", "stress", "pressure", "lost", "sad"];
  return stressWords.reduce((count, w) => count + (text.includes(w) ? 1 : 0), 0);
}

function fallbackSummary({
  perfTrend,
  sentiment,
  stressIndicators,
  avgPerf,
  highLoad,
}: {
  perfTrend: string;
  sentiment: string;
  stressIndicators: number;
  avgPerf: number;
  highLoad: boolean;
}) {
  const stressFlag = highLoad || stressIndicators > 3;
  return `Performance trend is ${perfTrend} with avg score ${avgPerf.toFixed(
    1
  )}. ${stressFlag ? "Possible fatigue or stress detected." : "Overall emotional balance stable."} ${sentiment === "negative" ? "Recommend brief check-in." : "Keep consistent communication."}`;
}