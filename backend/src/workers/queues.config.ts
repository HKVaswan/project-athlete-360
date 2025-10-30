/**
 * src/workers/queues.config.ts
 * ---------------------------------------------------------------------
 * Central configuration for all BullMQ queues across the system.
 *
 * Features:
 *  - Centralized retry, concurrency, and backoff settings
 *  - Easy scaling by simply adjusting values here
 *  - Consistent naming convention for all workers
 *  - Environment-safe defaults for production readiness
 */

import { JobsOptions, QueueOptions } from "bullmq";
import { config } from "../config";

/**
 * Define queue names in one place.
 * Use consistent, lowercase, hyphen-separated keys.
 */
export const QueueNames = {
  EMAIL: "email",
  NOTIFICATION: "notification",
  RESOURCE_PROCESSING: "resource-processing",
  PDF_PROCESSING: "pdf-processing",
  REPORT_GENERATION: "report-generation",
  FEEDBACK_PROCESSING: "feedback-processing",
  ANALYTICS: "analytics",
  SESSION_REMINDER: "session-reminder",
  THUMBNAIL: "thumbnail",
  CLEANUP: "cleanup",
  CACHE_CLEANUP: "cache-cleanup",
  SECURITY_AUDIT: "security-audit",
  AI_PROCESSING: "ai-processing",
  AI_INSIGHTS: "ai-insights",
  DATA_SYNC: "data-sync",
  BACKUP: "backup",
  RESTORE: "restore",
  QUEUE_MONITOR: "queue-monitor",
  UPTIME_MONITOR: "uptime-monitor",
  ERROR_MONITOR: "error-monitor",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

/**
 * Global queue options applied to all BullMQ queues.
 * Customize concurrency and retry policy per environment.
 */
export const defaultQueueOptions: QueueOptions = {
  connection: {
    host: config.redisHost || "127.0.0.1",
    port: config.redisPort ? Number(config.redisPort) : 6379,
    password: config.redisPassword || undefined,
  },
  defaultJobOptions: {
    attempts: 5, // retry count before failure
    backoff: {
      type: "exponential",
      delay: 2000, // exponential backoff
    },
    removeOnComplete: true, // auto-clean completed jobs
    removeOnFail: false, // keep failed jobs for debugging
  } as JobsOptions,
};

/**
 * Optional: fine-tune concurrency or retries per queue
 */
export const queueSettings: Record<QueueName, Partial<JobsOptions>> = {
  [QueueNames.EMAIL]: { attempts: 3, backoff: { type: "fixed", delay: 1000 } },
  [QueueNames.NOTIFICATION]: { attempts: 3, backoff: { type: "fixed", delay: 1500 } },
  [QueueNames.RESOURCE_PROCESSING]: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
  [QueueNames.ANALYTICS]: { attempts: 2 },
  [QueueNames.AI_PROCESSING]: { attempts: 4, backoff: { type: "exponential", delay: 2500 } },
  [QueueNames.REPORT_GENERATION]: { attempts: 3 },
  [QueueNames.BACKUP]: { attempts: 2 },
  [QueueNames.RESTORE]: { attempts: 2 },
};

/**
 * Utility: Get safe, standardized queue options.
 */
export const getQueueOptions = (queueName: QueueName): QueueOptions => {
  return {
    ...defaultQueueOptions,
    defaultJobOptions: {
      ...defaultQueueOptions.defaultJobOptions,
      ...queueSettings[queueName],
    },
  };
};

export const queueConfig = {
  QueueNames,
  defaultQueueOptions,
  queueSettings,
  getQueueOptions,
};

export default queueConfig;