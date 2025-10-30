// backend/src/workers/ai/aiScheduler.ts

import { Queue, Job, QueueScheduler, Worker } from "bullmq";
import { logger } from "../../logger";
import { config } from "../../config";
import IORedis from "ioredis";
import { AI_TASK_PROFILES, AI_RUNTIME } from "./aiConstants";

// Redis connection for job orchestration
const connection = new IORedis(config.redisUrl || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

// Central queue for all AI jobs
const aiQueue = new Queue("ai-scheduler", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: AI_RUNTIME.JOB_RETRY_LIMIT,
    backoff: { type: "exponential", delay: 3000 },
  },
});

// Scheduler to manage delayed/repeated jobs
const aiQueueScheduler = new QueueScheduler("ai-scheduler", { connection });

/**
 * Schedules an AI job dynamically based on task type
 */
export async function scheduleAIJob(
  type: keyof typeof AI_TASK_PROFILES,
  payload: any,
  priority = 3
) {
  try {
    const options = AI_TASK_PROFILES[type];
    const job = await aiQueue.add(type, payload, {
      priority,
      attempts: options.retries,
      timeout: AI_RUNTIME.REQUEST_TIMEOUT_MS,
    });

    logger.info(
      `[AI SCHEDULER] Job '${type}' added (ID: ${job.id}) | Priority: ${priority}`
    );
    return job;
  } catch (error: any) {
    logger.error(`[AI SCHEDULER] ❌ Failed to schedule job '${type}': ${error.message}`);
    throw error;
  }
}

/**
 * Monitors the health and performance of the AI job system.
 * Can be used by monitoring dashboards or health APIs.
 */
export async function getAISchedulerStatus() {
  const counts = await aiQueue.getJobCounts();
  const metrics = {
    ...counts,
    active: counts.active || 0,
    waiting: counts.waiting || 0,
    delayed: counts.delayed || 0,
    failed: counts.failed || 0,
    completed: counts.completed || 0,
  };

  const redisStatus = connection.status === "ready" ? "healthy" : "unhealthy";

  return {
    queue: "ai-scheduler",
    redisStatus,
    metrics,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Worker that orchestrates routing of AI tasks
 * Each job type gets dispatched to the appropriate downstream queue.
 */
const aiRouterWorker = new Worker(
  "ai-scheduler",
  async (job: Job) => {
    logger.info(`[AI ROUTER] 🚀 Routing job '${job.name}' (ID: ${job.id})`);

    switch (job.name) {
      case "FEEDBACK_ANALYSIS":
        await routeTo("aiFeedback");
        break;
      case "PERFORMANCE_EVAL":
        await routeTo("aiPerformance");
        break;
      case "MENTAL_WELLNESS":
        await routeTo("aiMentalWellness");
        break;
      case "STRATEGY_ADVICE":
        await routeTo("aiStrategy");
        break;
      case "DATA_SUMMARIZATION":
        await routeTo("aiAnalytics");
        break;
      default:
        logger.warn(`[AI ROUTER] Unknown job type '${job.name}'`);
    }

    return { routed: job.name };
  },
  {
    concurrency: AI_RUNTIME.MAX_PARALLEL_JOBS,
    connection,
  }
);

/**
 * Helper to route jobs to corresponding worker queues
 */
async function routeTo(queueName: string) {
  const queue = new Queue(queueName, { connection });
  await queue.add("process", { initiatedFrom: "ai-scheduler" });
  logger.info(`[AI ROUTER] Job forwarded to queue '${queueName}'`);
}

/**
 * Graceful shutdown of scheduler and workers
 */
export async function shutdownAIScheduler() {
  logger.info("[AI SCHEDULER] 🔻 Shutting down gracefully...");
  await Promise.all([
    aiQueueScheduler.close(),
    aiQueue.close(),
    aiRouterWorker.close(),
    connection.quit(),
  ]);
  logger.info("[AI SCHEDULER] ✅ Shutdown complete");
}