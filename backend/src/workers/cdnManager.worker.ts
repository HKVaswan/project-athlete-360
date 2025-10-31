import { Job } from "bullmq";
import { logger } from "../logger";
import { config } from "../config";
import { purgeCDNCache, syncFileToCDN } from "../lib/cdn";
import { notifyAdmin } from "../lib/notifications";

/**
 * Handles CDN management tasks:
 *  - Purging invalid caches
 *  - Syncing updated assets
 *  - Monitoring CDN health
 *  - Auto-retry on failure
 */

export default async function (job: Job) {
  logger.info(`[CDN MANAGER] Processing job ${job.id}: ${job.name}`);

  const { type, payload } = job.data;

  try {
    switch (type) {
      case "PURGE_CACHE":
        await handleCachePurge(payload);
        break;

      case "SYNC_FILE":
        await handleFileSync(payload);
        break;

      case "CDN_HEALTH_CHECK":
        await handleHealthCheck();
        break;

      default:
        logger.warn(`[CDN MANAGER] Unknown job type: ${type}`);
    }

    logger.info(`[CDN MANAGER] ✅ Job ${job.id} completed successfully.`);
  } catch (err: any) {
    logger.error(`[CDN MANAGER] ❌ Job ${job.id} failed: ${err.message}`);

    // Notify system admin on repeated failure
    await notifyAdmin({
      subject: "⚠️ CDN Worker Error",
      message: `Job ${job.name} failed: ${err.message}`,
      context: { jobId: job.id, payload },
    });

    throw err;
  }
}

/**
 * Handles cache purge requests for CDN
 */
async function handleCachePurge(payload: { urls?: string[] }) {
  const urls = payload.urls || [];
  logger.info(`[CDN MANAGER] Purging CDN cache for ${urls.length} URLs...`);

  await purgeCDNCache(urls);
  logger.info(`[CDN MANAGER] ✅ Cache purge completed.`);
}

/**
 * Syncs local or S3 file updates to the CDN
 */
async function handleFileSync(payload: { filePath: string; cdnPath: string }) {
  logger.info(`[CDN MANAGER] Syncing file: ${payload.filePath}`);
  await syncFileToCDN(payload.filePath, payload.cdnPath);
  logger.info(`[CDN MANAGER] ✅ File synced to CDN path: ${payload.cdnPath}`);
}

/**
 * Checks CDN health and reports status
 */
async function handleHealthCheck() {
  logger.info(`[CDN MANAGER] Running CDN health check...`);

  // Example: ping the CDN endpoint or provider API
  const cdnStatus = await fetch(config.cdnHealthEndpoint || "https://cdn.example.com/health").then(
    (res) => res.ok
  );

  if (!cdnStatus) {
    logger.warn(`[CDN MANAGER] ⚠️ CDN health check failed.`);
    await notifyAdmin({
      subject: "⚠️ CDN Health Alert",
      message: "CDN health check failed. Verify provider or network configuration.",
    });
  } else {
    logger.info(`[CDN MANAGER] ✅ CDN health OK.`);
  }
}