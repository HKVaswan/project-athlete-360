/**
 * src/workers/worker.types.ts
 * ---------------------------------------------------------------------
 * Centralized TypeScript definitions for all background job payloads.
 *
 * Features:
 *  - Type-safe job data structures
 *  - Shared between producers and processors
 *  - Organized by domain (email, AI, analytics, etc.)
 *  - Prevents accidental schema mismatch in workers
 */

import { QueueName } from "./queues.config";

/**
 * Base job data shared by all workers
 */
export interface BaseJobData {
  createdBy?: string; // user/admin id (if triggered manually)
  timestamp?: string; // ISO timestamp when job was enqueued
}

/**
 * Email jobs
 */
export interface EmailJob extends BaseJobData {
  type: "invitation" | "passwordReset" | "sessionReminder" | "custom";
  to: string;
  subject?: string;
  template?: string;
  context?: Record<string, any>;
}

/**
 * Notification jobs (in-app, push, etc.)
 */
export interface NotificationJob extends BaseJobData {
  recipientId: string;
  title: string;
  message: string;
  type?: "info" | "alert" | "reminder";
  link?: string;
}

/**
 * AI processing jobs
 */
export interface AIJob extends BaseJobData {
  model: string;
  input: string | Record<string, any>;
  context?: Record<string, any>;
  saveToDb?: boolean;
}

/**
 * Analytics and insights jobs
 */
export interface AnalyticsJob extends BaseJobData {
  eventType: string;
  entityId?: string;
  metrics?: Record<string, number>;
  metadata?: Record<string, any>;
}

/**
 * Resource (uploads, PDFs, etc.)
 */
export interface ResourceJob extends BaseJobData {
  resourceId: string;
  filePath: string;
  type: "pdf" | "image" | "video" | "document";
  processType?: "thumbnail" | "extract-text" | "compress" | "analyze";
}

/**
 * Backup and restore jobs
 */
export interface BackupJob extends BaseJobData {
  type: "manual" | "scheduled";
  backupPath?: string;
  institutionId?: string;
}

export interface RestoreJob extends BaseJobData {
  sourcePath: string;
  institutionId?: string;
  restoreType?: "partial" | "full";
}

/**
 * Session reminder jobs
 */
export interface SessionReminderJob extends BaseJobData {
  sessionId: string;
  athleteEmail: string;
  sessionDate: string;
  coachName: string;
}

/**
 * Security audit jobs
 */
export interface SecurityAuditJob extends BaseJobData {
  scanType: "auth" | "api" | "file" | "permission";
  scope?: string;
  initiatedBy?: string;
}

/**
 * Define union of all job payloads
 */
export type WorkerJobPayload =
  | EmailJob
  | NotificationJob
  | AIJob
  | AnalyticsJob
  | ResourceJob
  | BackupJob
  | RestoreJob
  | SessionReminderJob
  | SecurityAuditJob;

/**
 * Typed structure for all job entries in the system
 */
export interface WorkerJob<T = WorkerJobPayload> {
  queue: QueueName;
  name: string;
  data: T;
}

/**
 * Type guard helper for runtime validation
 */
export const isJobOfType = <T extends WorkerJobPayload>(
  job: any,
  typeKey: keyof T
): job is T => {
  return job && typeof job === "object" && typeKey in job;
};