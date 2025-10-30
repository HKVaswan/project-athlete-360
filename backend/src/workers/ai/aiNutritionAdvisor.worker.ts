/**
 * aiNutritionAdvisor.worker.ts
 * -------------------------------------------------------------
 * AI Nutrition Advisor Worker (Enterprise Grade)
 *
 * Purpose:
 *  - Produce quick nutrition recommendations for an athlete based on:
 *      - basic profile (age, gender, height, weight if available)
 *      - recent training load & session duration
 *      - injury / medical constraints (simple flags)
 *  - Return:
 *      - estimated daily calories (maintenance / target for gain/loss)
 *      - macronutrient split (protein / carbs / fats)
 *      - short coach-facing guidance and athlete-facing action items
 *
 * Design goals:
 *  - Robust to missing athlete biometric data (fallbacks)
 *  - Safe AI use via a wrapper (safeAIInvoke) with timeout/fallbacks
 *  - Idempotent & non-destructive (only creates logs / suggestions; does not modify athlete master data)
 *  - Ready to extend with wearable data and diet history
 */

import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { Errors } from "../../utils/errors";
import { safeAIInvoke } from "../../utils/aiUtils";

type Payload = {
  athleteId: string;
  timeframe?: "week" | "month";
  target?: "maintain" | "cut" | "bulk";
};

export default async function (job: Job<Payload>) {
  const { athleteId, timeframe = "week", target = "maintain" } = job.data;
  logger.info(`[AI_NUTRITION] Starting job ${job.id} for athlete=${athleteId} target=${target}`);

  try {
    // 1) Fetch athlete basic profile + recent training load
    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        sessions: {
          where: { date: { gte: calculateSince(timeframe) } },
          select: { duration: true, notes: true, loadScore: true },
        },
        injuries: {
          where: { date: { gte: calculateSince(timeframe) } },
          select: { description: true, severity: true },
        },
      },
    });

    if (!athlete) throw Errors.NotFound("Athlete not found");

    // 2) Derive simple biometric inputs (weight/height optional fields may be present in contactInfo or settings)
    const profile = extractProfileFromAthlete(athlete);

    // 3) Compute training load summary
    const trainingSummary = summarizeTraining(athlete.sessions);

    // 4) Estimate caloric needs (Mifflin-St Jeor fallback)
    const calorieEstimates = estimateCalories(profile, trainingSummary.activityLevel, target);

    // 5) Macronutrient suggestions (protein prioritized for athletes)
    const macros = computeMacros(calorieEstimates.targetCalories, profile, target);

    // 6) Form a short guidance note
    let aiGuidance = null;
    try {
      // Attempt an AI concise advice (safe wrapper)
      aiGuidance = await safeAIInvoke(async (ai) => {
        const prompt = `
You are a concise sports nutrition advisor.
Athlete: ${profile.name || "N/A"}, age:${profile.age ?? "N/A"}, gender:${profile.gender ?? "N/A"}.
Recent weekly training: ${trainingSummary.totalSessions} sessions, avg duration ${trainingSummary.avgDuration.toFixed(
          1
        )} min, activityLevel: ${trainingSummary.activityLevel}.
Injuries (if any): ${athlete.injuries.length ? athlete.injuries.map((i) => i.description).join("; ") : "none"}.
Provide a short (max 60 words) athlete-facing meal & recovery advice aligned with target: ${target}.
Also give one coach-facing note (single sentence) about nutrition monitoring.
`;
        const resp = await ai?.summarize?.(prompt);
        // expect string
        return typeof resp === "string" ? resp : null;
      });
    } catch (err) {
      logger.warn(`[AI_NUTRITION] AI assist failed, using fallback advice: ${err?.message || err}`);
      aiGuidance = null;
    }

    const suggestion = {
      athleteId,
      generatedAt: new Date(),
      profile,
      trainingSummary,
      calories: calorieEstimates,
      macros,
      guidance: aiGuidance ?? fallbackGuidance(profile, macros, target),
    };

    // 7) Persist suggestion as an advisory record (non-destructive)
    const record = await prisma.resource.create({
      data: {
        uploaderId: "system", // or some system user id from env
        institutionId: athlete.institutionId ?? undefined,
        title: `Nutrition Suggestion - ${profile.name ?? athlete.name} - ${new Date().toISOString().slice(0, 10)}`,
        description: JSON.stringify(suggestion, null, 2),
        type: "nutrition_advice",
        fileUrl: null,
        visibility: "institution",
      },
    });

    logger.info(`[AI_NUTRITION] ✅ Job ${job.id} completed; record ${record.id} created.`);
    return { success: true, suggestion, recordId: record.id };
  } catch (err: any) {
    logger.error(`[AI_NUTRITION] ❌ Job ${job.id} failed: ${err?.message || err}`);
    throw Errors.Server("Nutrition advisor processing failed");
  }
}

/* -------------------------
   Helper functions
   ------------------------- */

function calculateSince(timeframe: "week" | "month") {
  const d = new Date();
  if (timeframe === "week") d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);
  return d;
}

/**
 * Attempts to extract lightweight profile: weight/height/age/gender/name.
 * We store fallback values if missing.
 */
function extractProfileFromAthlete(athlete: any) {
  // Many systems store additional fields in athlete.contactInfo or user.settings as JSON.
  // Try common places safely.
  let weight: number | null = null;
  let height: number | null = null;
  let age: number | null = null;
  let gender: string | null = athlete.gender ?? null;
  let name: string | null = athlete.name ?? athlete.user?.name ?? null;

  try {
    // contactInfo could be string or JSON; settings is JSON.
    const contact = athlete.contactInfo;
    if (contact) {
      if (typeof contact === "string") {
        try {
          const parsed = JSON.parse(contact);
          weight = parsed.weight ?? weight;
          height = parsed.height ?? height;
          age = parsed.age ?? age;
        } catch {
          // ignore
        }
      } else if (typeof contact === "object") {
        weight = contact.weight ?? weight;
        height = contact.height ?? height;
        age = contact.age ?? age;
      }
    }

    if (!age && athlete.user?.settings) {
      const s = athlete.user.settings as any;
      age = s?.age ?? age;
      weight = s?.weight ?? weight;
      height = s?.height ?? height;
    }
  } catch (e) {
    // ignore parsing issues
  }

  // Derive age if we have dob
  if (!age && athlete.dob) {
    const birth = new Date(athlete.dob);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
  }

  return { name, age, gender, weight, height };
}

/**
 * Summarize training sessions quickly to estimate activity level.
 */
function summarizeTraining(sessions: any[]) {
  const totalSessions = sessions?.length ?? 0;
  const avgDuration =
    (sessions?.reduce((acc: number, s: any) => acc + (s.duration || 0), 0) || 0) /
    Math.max(1, totalSessions);
  // average loadScore if present
  const avgLoad =
    (sessions?.reduce((acc: number, s: any) => acc + (s.loadScore || 0), 0) || 0) /
    Math.max(1, totalSessions);

  // crude activity level classification
  const activityLevel =
    totalSessions >= 5 || avgDuration >= 75 || avgLoad > 60 ? "high" : totalSessions >= 3 ? "moderate" : "low";

  return { totalSessions, avgDuration, avgLoad, activityLevel };
}

/**
 * Estimate calories using Mifflin-St Jeor (if weight/height/age known), otherwise fallback to activity multipliers.
 */
function estimateCalories(
  profile: { weight?: number | null; height?: number | null; age?: number | null; gender?: string | null },
  activityLevel: "low" | "moderate" | "high",
  target: "maintain" | "cut" | "bulk"
) {
  const { weight, height, age, gender } = profile;

  const activityFactor = activityLevel === "high" ? 1.6 : activityLevel === "moderate" ? 1.45 : 1.3;

  let maintenance = 2200; // default fallback

  if (weight && height && age) {
    // Mifflin-St Jeor
    // men: (10 * weight kg) + (6.25 * height cm) - (5 * age) + 5
    // women: same -161
    const base =
      10 * weight + 6.25 * (height ?? 170) - 5 * (age ?? 25) + (gender === "female" ? -161 : 5);
    maintenance = Math.round(base * activityFactor);
  } else if (weight) {
    maintenance = Math.round((weight as number) * 24 * activityFactor); // crude
  } else {
    // keep default but alter a bit based on activityLevel
    maintenance = Math.round(maintenance * activityFactor / 1.4);
  }

  const deltas = { maintain: 0, cut: -0.15, bulk: 0.12 } as const;
  const targetCalories = Math.round(maintenance * (1 + deltas[target]));

  return { maintenance, targetCalories, activityFactor, target };
}

/**
 * Compute macros: protein priority (1.6-2.2 g/kg for athletes), carbs depend on activity, fats 20-30%.
 */
function computeMacros(
  targetCalories: number,
  profile: { weight?: number | null },
  target: "maintain" | "cut" | "bulk"
) {
  const weightKg = profile.weight ?? 70; // fallback
  const proteinPerKg = target === "bulk" ? 1.8 : target === "cut" ? 2.0 : 1.7;
  const proteinGrams = Math.round(proteinPerKg * weightKg);
  const proteinCals = proteinGrams * 4;

  // carbs: scale with calories left and target
  const fatPercent = 0.25;
  const fatCals = Math.round(targetCalories * fatPercent);
  const fatGrams = Math.round(fatCals / 9);

  const carbsCals = Math.max(0, targetCalories - (proteinCals + fatCals));
  const carbsGrams = Math.round(carbsCals / 4);

  return {
    proteinGrams,
    fatGrams,
    carbsGrams,
    proteinCals,
    fatCals,
    carbsCals,
    distributionPercent: {
      protein: Math.round((proteinCals / targetCalories) * 100),
      fat: Math.round((fatCals / targetCalories) * 100),
      carbs: Math.round((carbsCals / targetCalories) * 100),
    },
  };
}

/**
 * Fallback guidance text if AI summarization unavailable.
 */
function fallbackGuidance(profile: any, macros: any, target: string) {
  return (
    `Target: ${target}. Estimated calories: ${macros ? macros.proteinCals + macros.fatCals + macros.carbsCals : "N/A"}. ` +
    `Protein ≈ ${macros?.proteinGrams ?? "N/A"} g/day. ` +
    `Coach note: monitor body mass & energy; adjust ±10% based on weekly performance.`
  );
}