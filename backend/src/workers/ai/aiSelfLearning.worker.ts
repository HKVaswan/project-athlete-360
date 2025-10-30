import { Job } from "bullmq";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { queues } from "../index";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Optional local model store (later replace with vector DB or cloud model store)
const MODEL_STORE_PATH = path.join(__dirname, "../../../models/ai/");
if (!fs.existsSync(MODEL_STORE_PATH)) fs.mkdirSync(MODEL_STORE_PATH, { recursive: true });

const MIN_NEW_RECORDS = 25; // Minimum number of new verified records before retraining
const MAX_BATCH_SIZE = 500; // Prevent excessive memory use during retrain
const RETRAIN_INTERVAL_DAYS = 7; // Skip retrain if recent

type TrainingPayload = {
  modelType?: "performance" | "wellness" | "recovery";
  athleteIds?: string[];
  triggeredBy?: string; // e.g. "cron" | "manual"
  force?: boolean;
};

/**
 * Utility: Generate safe hash for model versioning
 */
const versionHash = (data: any) => {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 12);
};

/**
 * Helper: Load last training metadata
 */
const getLastTrainingMeta = async (modelType: string) => {
  try {
    const record = await prisma.modelTrainingHistory.findFirst({
      where: { modelType },
      orderBy: { createdAt: "desc" },
    });
    return record;
  } catch {
    return null;
  }
};

/**
 * Helper: Fetch new verified data for learning
 */
const fetchTrainingData = async (modelType: string, athleteIds?: string[]) => {
  switch (modelType) {
    case "performance":
      return prisma.performance.findMany({
        where: { verified: true, ...(athleteIds ? { athleteId: { in: athleteIds } } : {}) },
        orderBy: { createdAt: "desc" },
        take: MAX_BATCH_SIZE,
      });
    case "wellness":
      return prisma.assessment.findMany({
        where: { type: "wellness", verified: true },
        orderBy: { createdAt: "desc" },
        take: MAX_BATCH_SIZE,
      });
    case "recovery":
      return prisma.session.findMany({
        where: { completed: true, feedbackScore: { not: null } },
        orderBy: { createdAt: "desc" },
        take: MAX_BATCH_SIZE,
      });
    default:
      return [];
  }
};

/**
 * Simulated retraining logic (AI placeholder)
 * Replace this later with actual model logic or external service.
 */
const simulateRetraining = async (modelType: string, data: any[]) => {
  logger.info(`[AI:SelfLearning] Simulating model training for ${modelType} with ${data.length} records...`);

  // simple stats extraction
  const stats = {
    sampleCount: data.length,
    avg: Math.round(Math.random() * 100),
    variance: Math.random().toFixed(2),
    correlation: Math.random().toFixed(2),
  };

  const modelData = {
    modelType,
    version: versionHash(stats),
    trainedAt: new Date().toISOString(),
    metrics: stats,
  };

  const filePath = path.join(MODEL_STORE_PATH, `${modelType}-${modelData.version}.json`);
  fs.writeFileSync(filePath, JSON.stringify(modelData, null, 2));

  logger.info(`[AI:SelfLearning] Model retrained & stored at ${filePath}`);
  return modelData;
};

/**
 * Persist training metadata in DB
 */
const saveTrainingMeta = async (modelType: string, modelData: any, triggeredBy: string) => {
  try {
    const meta = await prisma.modelTrainingHistory.create({
      data: {
        modelType,
        version: modelData.version,
        metrics: modelData.metrics,
        triggeredBy,
      },
    });
    return meta;
  } catch (err) {
    logger.warn("[AI:SelfLearning] Failed to store training metadata:", err);
    return null;
  }
};

/**
 * Main Worker
 */
export default async function (job: Job<TrainingPayload>) {
  const { modelType = "performance", athleteIds, triggeredBy = "cron", force = false } = job.data;
  const startTime = Date.now();

  logger.info(`[AI:SelfLearning] 🚀 Starting self-learning for modelType=${modelType} triggeredBy=${triggeredBy}`);

  try {
    // Step 1: Fetch last training info
    const lastTraining = await getLastTrainingMeta(modelType);

    if (!force && lastTraining) {
      const daysSince = (Date.now() - new Date(lastTraining.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < RETRAIN_INTERVAL_DAYS) {
        logger.info(`[AI:SelfLearning] ⏸ Skipping retrain — last run ${daysSince.toFixed(1)} days ago.`);
        return { success: true, skipped: true, reason: "interval_not_reached" };
      }
    }

    // Step 2: Collect data
    const trainingData = await fetchTrainingData(modelType, athleteIds);
    if (!force && trainingData.length < MIN_NEW_RECORDS) {
      logger.info(`[AI:SelfLearning] ⏸ Not enough new verified data (${trainingData.length} records).`);
      return { success: true, skipped: true, reason: "insufficient_data" };
    }

    // Step 3: Train
    const modelData = await simulateRetraining(modelType, trainingData);

    // Step 4: Save metadata
    await saveTrainingMeta(modelType, modelData, triggeredBy);

    // Step 5: Trigger dependent AI updates
    if (queues["aiPerformanceForecast"]) {
      await queues["aiPerformanceForecast"].add(
        "refreshPredictions",
        { modelType, version: modelData.version },
        { removeOnComplete: true, attempts: 2 }
      );
      logger.info("[AI:SelfLearning] Triggered dependent AI forecast refresh.");
    }

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`[AI:SelfLearning] ✅ Retraining completed in ${duration}s (model ${modelData.version})`);

    return { success: true, duration, modelVersion: modelData.version };
  } catch (err: any) {
    logger.error(`[AI:SelfLearning] ❌ Training failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}