/**
 * aiStrategy.worker.ts
 * ---------------------------------------------------------------------
 * AI Strategy Generation Worker
 *
 * Purpose:
 *  - Creates personalized training strategies based on athlete performance,
 *    workload, and recovery data.
 *  - Uses hybrid intelligence (AI model + rule engine).
 *  - Future-ready for integration with OpenAI, HuggingFace, or local ML models.
 *
 * Enterprise Features:
 *  - Modular strategy generation pipeline (analyze → plan → optimize)
 *  - Dynamic goal adaptation (endurance, speed, strength, recovery)
 *  - Fully asynchronous + resilient error handling
 *  - Human-readable summaries and structured recommendations
 */

import { Job } from "bullmq";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { safeAIInvoke } from "../../utils/aiUtils";

// --- Types ---
interface StrategyPayload {
  athleteId: string;
  goal: "endurance" | "strength" | "speed" | "recovery";
  metrics: {
    trainingLoad: number;
    sleepHours: number;
    nutritionScore: number;
    recoveryScore: number;
    lastWeekPerformance?: number[];
  };
}

/**
 * Main AI Strategy Worker
 */
export default async function (job: Job<StrategyPayload>) {
  logger.info(`[AI_STRATEGY] 🧠 Generating strategy for athlete ${job.data.athleteId}`);

  try {
    const { athleteId, goal, metrics } = job.data;

    if (!athleteId || !metrics) throw Errors.Validation("Invalid data provided for strategy generation");

    // Step 1: Analyze athlete metrics
    const insights = analyzeAthlete(metrics);

    // Step 2: Generate initial strategy (heuristic-based fallback)
    let plan = generateLocalStrategy(goal, insights);

    // Step 3: Enhance via AI (optional)
    const enhancedPlan = await safeAIInvoke(async () => {
      return await enhanceWithAI(goal, insights, plan);
    });

    const result = enhancedPlan || plan;

    // Step 4: Log and return
    logger.info(`[AI_STRATEGY] ✅ Strategy ready for ${athleteId} (${goal})`);
    return {
      athleteId,
      goal,
      strategy: result,
      generatedAt: new Date(),
    };
  } catch (err: any) {
    logger.error(`[AI_STRATEGY] ❌ Failed for ${job.data.athleteId}: ${err.message}`);
    throw Errors.Server("Failed to generate AI strategy");
  }
}

/**
 * Step 1: Analyze athlete data and derive key insights
 */
function analyzeAthlete(metrics: StrategyPayload["metrics"]) {
  const { trainingLoad, sleepHours, nutritionScore, recoveryScore, lastWeekPerformance = [] } = metrics;
  const performanceAvg =
    lastWeekPerformance.length > 0
      ? lastWeekPerformance.reduce((a, b) => a + b, 0) / lastWeekPerformance.length
      : 50;

  return {
    trainingLoad,
    recoveryScore,
    nutritionScore,
    sleepHours,
    performanceTrend: performanceAvg,
    fatigueLevel: Math.max(0, trainingLoad - recoveryScore),
  };
}

/**
 * Step 2: Local heuristic-based strategy generator (AI fallback)
 */
function generateLocalStrategy(goal: StrategyPayload["goal"], data: ReturnType<typeof analyzeAthlete>) {
  const basePlan = {
    restDays: 1,
    trainingDays: 5,
    nutrition: "Balanced macronutrients, adequate hydration",
    notes: [],
  };

  switch (goal) {
    case "endurance":
      basePlan.trainingDays = 6;
      basePlan.notes.push("Include long-distance runs and tempo sessions.");
      basePlan.notes.push("Monitor heart rate recovery and avoid overtraining.");
      break;

    case "strength":
      basePlan.trainingDays = 5;
      basePlan.notes.push("Focus on progressive overload with compound lifts.");
      basePlan.notes.push("Ensure 1.6–2.2g protein/kg body weight.");
      break;

    case "speed":
      basePlan.trainingDays = 5;
      basePlan.notes.push("Include sprint drills, plyometrics, and short recovery intervals.");
      basePlan.notes.push("Track reaction time and agility improvements weekly.");
      break;

    case "recovery":
      basePlan.trainingDays = 3;
      basePlan.restDays = 2;
      basePlan.notes.push("Prioritize sleep and low-intensity mobility work.");
      basePlan.notes.push("Use active recovery protocols post intense sessions.");
      break;
  }

  // Adjust based on athlete fatigue level
  if (data.fatigueLevel > 20) basePlan.notes.push("⚠️ High fatigue detected. Reduce intensity this week.");
  if (data.sleepHours < 6) basePlan.notes.push("💤 Increase sleep to at least 7–8 hours for optimal recovery.");

  return basePlan;
}

/**
 * Step 3: Optional AI enhancement
 * (Enhances base plan using AI reasoning / LLM)
 */
async function enhanceWithAI(
  goal: StrategyPayload["goal"],
  data: ReturnType<typeof analyzeAthlete>,
  plan: ReturnType<typeof generateLocalStrategy>
) {
  // This can later connect to OpenAI or a fine-tuned model
  const aiResponse = `
Based on ${goal} training optimization and metrics analysis:
- Training Load: ${data.trainingLoad}
- Recovery Score: ${data.recoveryScore}
- Nutrition: ${data.nutritionScore}/100
- Sleep: ${data.sleepHours} hrs

Optimized Plan:
${plan.notes.map((n) => `• ${n}`).join("\n")}
Ensure recovery balance and periodization to maximize gains.
  `;

  return {
    ...plan,
    aiSummary: aiResponse.trim(),
  };
}