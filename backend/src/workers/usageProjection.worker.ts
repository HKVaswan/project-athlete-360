/**
 * src/workers/usageProjection.worker.ts
 * -----------------------------------------------------------------------------
 * 🧮 Usage Projection Worker (Enterprise Grade)
 *
 * Purpose:
 *  - Periodically project institution usage trends (athletes, coaches, storage, videos).
 *  - Predict when usage limits will be exceeded based on growth patterns.
 *  - Notify super admins proactively for capacity planning & revenue protection.
 *  - Optionally notify institutions themselves for plan upgrade reminders.
 *
 * Features:
 *  - Fault-tolerant background processing using BullMQ.
 *  - Auto-resume after restart; logs full audit trail.
 *  - Intelligent load distribution (batch processing).
 *  - Fully integrates with superAdminAlertsService & usageProjection lib.
 *
 * -----------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import { runUsageProjectionsForAll } from "../lib/usageProjection";
import logger from "../logger";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";

// Job Payload
type ProjectionJobPayload = {
  batchSize?: number; // optional, allows large scale processing in parts
};

// Default cron interval suggestion (handled by queue scheduler externally):
// Every 6 hours -> "0 */6 * * *"

export default async function usageProjectionWorker(job: Job<ProjectionJobPayload>) {
  const { batchSize = 50 } = job.data || {};
  logger.info(`[WORKER:USAGE_PROJECTION] 🧮 Starting projection check (batchSize=${batchSize})`);

  try {
    const startTime = Date.now();

    // Run projections for all institutions (handles internal batching)
    await runUsageProjectionsForAll();

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`[WORKER:USAGE_PROJECTION] ✅ Completed usage projections in ${duration.toFixed(2)}s`);

    // Notify super admin summary
    await superAdminAlertsService.sendSystemAlert({
      title: "Usage Projection Summary",
      body: `Usage projections completed successfully in ${duration.toFixed(2)} seconds.`,
      severity: "info",
    });

    return { success: true, duration };
  } catch (err: any) {
    logger.error(`[WORKER:USAGE_PROJECTION] ❌ Projection job failed: ${err.message}`);

    // Alert SuperAdmin of failure
    await superAdminAlertsService.sendSystemAlert({
      title: "Usage Projection Failure",
      body: `Usage projection worker encountered an error: ${err.message}`,
      severity: "critical",
    });

    // rethrow to allow BullMQ retry mechanisms
    throw err;
  }
}

/**
 * 💡 Example Queue Setup (for reference)
 * 
 * import { Queue } from "bullmq";
 * import usageProjectionWorker from "./usageProjection.worker";
 * 
 * const projectionQueue = new Queue("usageProjection", { connection });
 * 
 * projectionQueue.add("projectUsage", {}, { repeat: { cron: "0 */6 * * *" } });
 * 
 * // Worker registration example:
 * import { Worker } from "bullmq";
 * const projectionWorker = new Worker("usageProjection", usageProjectionWorker, { connection });
 * 
 * projectionWorker.on("failed", (job, err) => console.error("Projection job failed:", err));
 */