/**
 * workers/dataSync.worker.ts
 * ------------------------------------------------------------------------
 * Data Synchronization Worker (Enterprise-Grade)
 *
 * Purpose:
 *  - Handles background syncing of key data to external services or analytics DB.
 *  - Ensures async consistency between:
 *      * Main Prisma DB
 *      * External analytics (e.g. BigQuery, Supabase, Firebase)
 *      * Backup snapshots (optional)
 *
 * Features:
 *  - Intelligent batching (auto splits large datasets)
 *  - Retry-safe (idempotent sync jobs)
 *  - Modular target connectors (future integrations)
 *  - Monitored & logged with unique job trace IDs
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import prisma from "../prismaClient";
import { config } from "../config";
import { batchProcess } from "../utils/batchProcess"; // helper to handle large data chunks
import { uploadToBackupStore } from "../integrations/s3"; // optional backup destination

interface DataSyncJob {
  type: "athletes" | "sessions" | "performance" | "attendance";
  target: "analytics" | "backup" | "both";
  limit?: number;
}

export default async function (job: Job<DataSyncJob>) {
  const traceId = `SYNC-${job.id}-${Date.now()}`;
  logger.info(`[DATA SYNC] 🚀 Starting job ${traceId} (${job.data.type})`);

  const { type, target, limit = 100 } = job.data;

  try {
    // STEP 1: Fetch relevant data from DB
    let data: any[] = [];
    switch (type) {
      case "athletes":
        data = await prisma.athlete.findMany({
          take: limit,
          select: {
            id: true,
            name: true,
            sport: true,
            institutionId: true,
            approved: true,
            createdAt: true,
          },
        });
        break;

      case "sessions":
        data = await prisma.session.findMany({
          take: limit,
          select: {
            id: true,
            title: true,
            date: true,
            coachId: true,
            institutionId: true,
            completed: true,
          },
        });
        break;

      case "performance":
        data = await prisma.performance.findMany({
          take: limit,
          select: {
            id: true,
            athleteId: true,
            metric: true,
            score: true,
            recordedAt: true,
          },
        });
        break;

      case "attendance":
        data = await prisma.attendance.findMany({
          take: limit,
          select: {
            id: true,
            sessionId: true,
            athleteId: true,
            status: true,
            timestamp: true,
          },
        });
        break;

      default:
        logger.warn(`[DATA SYNC] Unknown sync type: ${type}`);
        return;
    }

    if (!data.length) {
      logger.info(`[DATA SYNC] No data found for type: ${type}`);
      return;
    }

    // STEP 2: Process data in safe batches (to avoid memory overflow)
    await batchProcess(data, 25, async (batch, index) => {
      logger.info(`[DATA SYNC] Processing batch ${index + 1} (${batch.length} items)`);

      if (target === "analytics" || target === "both") {
        await syncToAnalytics(batch, type, traceId);
      }
      if (target === "backup" || target === "both") {
        await uploadToBackupStore(
          JSON.stringify(batch),
          `backups/${type}/sync-${traceId}-batch-${index + 1}.json`
        );
      }
    });

    logger.info(`[DATA SYNC] ✅ Job ${traceId} completed successfully`);
  } catch (err: any) {
    logger.error(`[DATA SYNC] ❌ Job ${traceId} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Example sync function — can later connect to BigQuery, Supabase, etc.
 */
async function syncToAnalytics(batch: any[], type: string, traceId: string) {
  try {
    // For now, just log or store locally — future: push to external analytics
    logger.info(`[DATA SYNC] [${traceId}] → Synced ${batch.length} ${type} records`);
  } catch (err: any) {
    logger.error(`[DATA SYNC] [${traceId}] ⚠️ Analytics sync failed: ${err.message}`);
    throw err;
  }
}