// src/workers/ai/aiCoachAssistant.worker.ts
/**
 * aiCoachAssistant.worker.ts
 *
 * Enterprise-grade AI assistant for coaches.
 * - Aggregates athletes’ performance, attendance, and well-being data.
 * - Generates actionable insights for coaches (e.g., who needs rest, motivation, or extra training).
 * - Uses a hybrid rule-based + lightweight AI approach (can plug into GPT/OpenAI later).
 * - Sends summaries or recommendations to coaches via queue or email.
 * - Automatically triggers alerts when anomalies are detected.
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";
import { config } from "../../config";

/**
 * Job Data Schema
 */
type JobData = {
  coachId: string;
  force?: boolean;
};

/**
 * Core thresholds & configuration
 */
const PERFORMANCE_DROP_THRESHOLD = 0.2;
const ATTENDANCE_LOW_THRESHOLD = 0.8;
const FATIGUE_RISK_THRESHOLD = 0.7;

/**
 * Utility: Normalize values between 0–1 range
 */
const normalize = (value: number, min: number, max: number): number => {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
};

/**
 * Core AI logic for assistant recommendations
 */
const analyzeAthlete = (athlete: any) => {
  const performance = athlete.performances ?? [];
  const attendance = athlete.attendance ?? [];
  const fatigueRisk = athlete.aiInsights?.risks?.fatigueRisk ?? 0;

  if (performance.length === 0) return null;

  const latestPerformance = performance[performance.length - 1]?.score ?? 0;
  const avgPerformance =
    performance.reduce((sum: number, p: any) => sum + (p.score || 0), 0) /
    performance.length;

  const performanceDrop = avgPerformance
    ? (avgPerformance - latestPerformance) / avgPerformance
    : 0;

  const attendanceRate =
    attendance.length > 0
      ? attendance.filter((a: any) => a.present).length / attendance.length
      : 1;

  const restNeeded =
    performanceDrop > PERFORMANCE_DROP_THRESHOLD || fatigueRisk > FATIGUE_RISK_THRESHOLD;
  const motivationNeeded = performanceDrop > 0.1 && fatigueRisk < 0.4;
  const atRisk = fatigueRisk > 0.8 || attendanceRate < ATTENDANCE_LOW_THRESHOLD;

  const recommendation = {
    athleteId: athlete.id,
    name: athlete.name,
    fatigueRisk,
    performanceDrop: parseFloat(performanceDrop.toFixed(2)),
    attendanceRate: parseFloat(attendanceRate.toFixed(2)),
    restNeeded,
    motivationNeeded,
    atRisk,
    suggestion: restNeeded
      ? "Recommend light recovery sessions and hydration."
      : motivationNeeded
      ? "Encourage through personalized coaching and positive reinforcement."
      : "Maintain current routine and monitor weekly.",
  };

  return recommendation;
};

/**
 * Send coach recommendations via queue/email
 */
const dispatchCoachReport = async (coachId: string, insights: any[]) => {
  try {
    const queue = queues["email"];
    const coach = await prisma.coach.findUnique({ where: { id: coachId }, include: { user: true } });

    if (!coach || !coach.user?.email) {
      logger.warn(`[AI:CoachAssistant] Coach email not found for ID ${coachId}`);
      return;
    }

    if (queue) {
      await queue.add("coach_report", {
        to: coach.user.email,
        subject: "📊 AI Weekly Athlete Insights Report",
        template: "coachReport",
        context: {
          coachName: coach.user.name || "Coach",
          insights,
          generatedAt: new Date().toLocaleString(),
        },
      });
      logger.info(`[AI:CoachAssistant] Report queued for coach ${coachId}`);
    } else {
      logger.warn("[AI:CoachAssistant] Email queue unavailable, skipping email dispatch.");
    }
  } catch (err: any) {
    logger.error(`[AI:CoachAssistant] Failed to dispatch report: ${err.message}`);
  }
};

/**
 * Main Worker Logic
 */
export default async function (job: Job<JobData>) {
  logger.info(`[AI:CoachAssistant] Job ${job.id} started`, { data: job.data });

  const startTime = Date.now();
  const coachId = job.data.coachId;

  try {
    // Validate coach
    const coach = await prisma.coach.findUnique({
      where: { id: coachId },
      include: {
        athletes: {
          include: {
            performances: {
              orderBy: { date: "asc" },
              take: 20,
            },
            attendance: {
              orderBy: { date: "desc" },
              take: 30,
            },
            aiInsights: true,
          },
        },
        user: true,
      },
    });

    if (!coach) {
      logger.warn(`[AI:CoachAssistant] Coach not found: ${coachId}`);
      return { success: false, reason: "coach_not_found" };
    }

    // Analyze all athletes
    const insights = [];
    for (const athlete of coach.athletes) {
      const result = analyzeAthlete(athlete);
      if (result) insights.push(result);
    }

    if (insights.length === 0) {
      logger.info(`[AI:CoachAssistant] No valid athlete insights for coach ${coachId}`);
      return { success: true, message: "no_insights" };
    }

    // Sort by priority (highest fatigue or lowest attendance first)
    const prioritized = insights.sort((a, b) => {
      const riskA = a.fatigueRisk + (1 - a.attendanceRate);
      const riskB = b.fatigueRisk + (1 - b.attendanceRate);
      return riskB - riskA;
    });

    // Dispatch report to email queue
    await dispatchCoachReport(coachId, prioritized);

    // Push summary to monitoring queue
    try {
      const monitorQueue = queues["analytics"];
      if (monitorQueue) {
        await monitorQueue.add("coach_insight_summary", {
          coachId,
          totalAthletes: coach.athletes.length,
          generatedAt: new Date().toISOString(),
          avgFatigue:
            insights.reduce((s, i) => s + i.fatigueRisk, 0) / insights.length || 0,
        });
      }
    } catch (err) {
      logger.warn("[AI:CoachAssistant] Failed to queue summary (non-fatal).");
    }

    logger.info(
      `[AI:CoachAssistant] Job ${job.id} completed in ${Date.now() - startTime}ms for coach ${coachId}`
    );

    return { success: true, totalAthletes: coach.athletes.length, insightsCount: insights.length };
  } catch (err: any) {
    logger.error(`[AI:CoachAssistant] Job ${job.id} failed: ${err.message}`, { stack: err.stack });
    return { success: false, error: err.message };
  }
}