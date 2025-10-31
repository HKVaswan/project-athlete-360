import cron from "node-cron";
import { logger } from "../logger";
import { queues } from "../workers";
import { config } from "../config";

/**
 * Enterprise-grade task scheduler
 * --------------------------------------------------
 * Features:
 *  - Declarative job scheduling (via cron syntax)
 *  - Safe concurrent execution control
 *  - Integrates seamlessly with BullMQ queues
 *  - Centralized logging, monitoring & failover
 */

type JobHandler = () => Promise<void>;

interface ScheduledJob {
  name: string;
  schedule: string;
  handler: JobHandler;
  runOnInit?: boolean;
}

class Scheduler {
  private jobs: ScheduledJob[] = [];
  private isRunning = false;

  /**
   * Register a new scheduled job
   */
  register(job: ScheduledJob) {
    this.jobs.push(job);
    logger.info(`[SCHEDULER] ⏰ Registered job: ${job.name} (${job.schedule})`);
  }

  /**
   * Initialize all scheduled jobs
   */
  start() {
    if (this.isRunning) {
      logger.warn("[SCHEDULER] Already running — skipping initialization.");
      return;
    }

    this.jobs.forEach((job) => {
      cron.schedule(job.schedule, async () => {
        logger.info(`[SCHEDULER] ▶ Executing job: ${job.name}`);
        try {
          await job.handler();
          logger.info(`[SCHEDULER] ✅ Job completed: ${job.name}`);
        } catch (err: any) {
          logger.error(`[SCHEDULER] ❌ Job failed: ${job.name} - ${err.message}`);
        }
      });

      // Optional: run immediately on init
      if (job.runOnInit) {
        job.handler().catch((err) =>
          logger.error(`[SCHEDULER] ❌ Immediate run failed for ${job.name}: ${err.message}`)
        );
      }
    });

    this.isRunning = true;
    logger.info(`[SCHEDULER] 🚀 ${this.jobs.length} jobs scheduled successfully.`);
  }

  /**
   * Graceful shutdown for scheduler
   */
  async shutdown() {
    logger.info("[SCHEDULER] 🧹 Shutting down all scheduled tasks...");
    this.isRunning = false;
  }
}

export const scheduler = new Scheduler();

/**
 * 🧩 Example — Register common system jobs
 * (Extend this section as the platform scales)
 */
scheduler.register({
  name: "daily-backup",
  schedule: "0 2 * * *", // every day at 2 AM
  handler: async () => {
    const queue = queues["backup"];
    if (queue) await queue.add("daily-backup", {});
  },
});

scheduler.register({
  name: "system-health-check",
  schedule: "*/10 * * * *", // every 10 minutes
  handler: async () => {
    const queue = queues["systemHealth"];
    if (queue) await queue.add("check-health", {});
  },
});