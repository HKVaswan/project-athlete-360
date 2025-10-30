import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";
import { z } from "zod";

const InjuryRiskSchema = z.object({
  athleteId: z.string(),
  workload: z.number(),
  fatigue: z.number(),
  sleepHours: z.number(),
  recoveryScore: z.number(),
  previousInjuryCount: z.number(),
});

type InjuryRiskInput = z.infer<typeof InjuryRiskSchema>;

/**
 * Compute injury risk using statistical heuristics + trend correlation
 * Returns a risk score (0–100)
 */
const computeRiskScore = (input: InjuryRiskInput): number => {
  const { workload, fatigue, sleepHours, recoveryScore, previousInjuryCount } = input;

  // Weighted algorithm — can be later replaced with ML model
  let risk = 0;
  risk += workload * 0.3;
  risk += fatigue * 0.25;
  risk += (8 - sleepHours) * 5; // sleep deficit
  risk += (100 - recoveryScore) * 0.25;
  risk += previousInjuryCount * 5;

  // Normalize to 0–100
  return Math.min(100, Math.max(0, Math.round(risk)));
};

/**
 * Fetch recent athlete data for evaluation
 */
const getAthleteData = async (athleteId: string) => {
  const [workloadData, wellnessData, injuries] = await Promise.all([
    prisma.session.findMany({
      where: { athleteId, completed: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { duration: true, intensity: true },
    }),
    prisma.assessment.findFirst({
      where: { athleteId, type: "wellness" },
      orderBy: { createdAt: "desc" },
      select: { fatigue: true, sleepHours: true, recoveryScore: true },
    }),
    prisma.injury.findMany({
      where: { athleteId },
      select: { id: true },
    }),
  ]);

  const workload =
    workloadData.reduce((sum, s) => sum + (s.duration || 0) * (s.intensity || 1), 0) /
    Math.max(1, workloadData.length);

  return {
    athleteId,
    workload: Math.min(workload / 10, 10),
    fatigue: wellnessData?.fatigue ?? 5,
    sleepHours: wellnessData?.sleepHours ?? 7,
    recoveryScore: wellnessData?.recoveryScore ?? 80,
    previousInjuryCount: injuries.length,
  };
};

/**
 * Save risk results in DB
 */
const saveRiskResult = async (athleteId: string, score: number, details: any) => {
  try {
    await prisma.aiInjuryRisk.upsert({
      where: { athleteId },
      update: { riskScore: score, details },
      create: { athleteId, riskScore: score, details },
    });
  } catch (err) {
    logger.error(`[AI:InjuryPrevention] Failed to save risk result for ${athleteId}: ${err.message}`);
  }
};

/**
 * Main Worker Function
 */
export default async function (job: Job<{ athleteIds?: string[]; triggeredBy?: string }>) {
  const { athleteIds, triggeredBy = "cron" } = job.data;
  const startTime = Date.now();

  logger.info(`[AI:InjuryPrevention] 🚀 Starting injury risk detection (triggered by ${triggeredBy})`);

  try {
    const athletes = athleteIds
      ? await prisma.athlete.findMany({ where: { id: { in: athleteIds } } })
      : await prisma.athlete.findMany({ select: { id: true } });

    for (const athlete of athletes) {
      const data = await getAthleteData(athlete.id);
      const validated = InjuryRiskSchema.safeParse(data);

      if (!validated.success) {
        logger.warn(`[AI:InjuryPrevention] Invalid data for ${athlete.id}`);
        continue;
      }

      const score = computeRiskScore(validated.data);
      await saveRiskResult(athlete.id, score, validated.data);

      // Trigger alert if risk is critical
      if (score >= 75 && queues["notification"]) {
        await queues["notification"].add(
          "injuryAlert",
          {
            type: "injuryRisk",
            athleteId: athlete.id,
            score,
            message: `High injury risk detected (score: ${score})`,
          },
          { removeOnComplete: true }
        );
        logger.warn(`[AI:InjuryPrevention] ⚠️ High risk detected for athlete ${athlete.id} (${score})`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[AI:InjuryPrevention] ✅ Completed in ${duration}s for ${athletes.length} athletes`);

    return { success: true, processed: athletes.length };
  } catch (err: any) {
    logger.error(`[AI:InjuryPrevention] ❌ Failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}