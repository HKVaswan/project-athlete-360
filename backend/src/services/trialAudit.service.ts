/**
 * src/services/trialAudit.service.ts
 * ------------------------------------------------------------------------
 * 🧠 Trial Abuse Prevention & Audit Service (Enterprise Grade)
 *
 * Prevents repeated use of free trial accounts by:
 *  - Tracking device fingerprints, IPs, browser agents, and email patterns
 *  - Hashing identifiers for privacy-safe cross-account detection
 *  - Alerting super admin when abuse thresholds are reached
 *  - Enforcing cooldown periods or blocking further registrations
 * ------------------------------------------------------------------------
 */

import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { superAdminAlertsService } from "./superAdminAlerts.service";
import { recordAuditEvent } from "./audit.service";

type TrialFingerprint = {
  ip: string;
  userAgent?: string;
  deviceId?: string; // optional, e.g., mobile app unique ID
  email?: string;
  institutionId?: string;
};

/* ------------------------------------------------------------------------
   🧩 Utility: Generate privacy-safe hash for detection
------------------------------------------------------------------------ */
const generateHash = (data: string) => {
  return crypto.createHash("sha256").update(data.trim().toLowerCase()).digest("hex");
};

/* ------------------------------------------------------------------------
   🚨 Check Trial Abuse
------------------------------------------------------------------------ */
export const detectTrialAbuse = async (fingerprint: TrialFingerprint) => {
  const { ip, userAgent, email, deviceId, institutionId } = fingerprint;

  const hashedIp = generateHash(ip);
  const hashedUA = userAgent ? generateHash(userAgent) : null;
  const hashedDevice = deviceId ? generateHash(deviceId) : null;
  const hashedEmailDomain = email?.includes("@")
    ? generateHash(email.split("@")[1])
    : null;

  // Search for prior trials matching any of these identifiers
  const potentialMatches = await prisma.trialAbuseLog.findMany({
    where: {
      OR: [
        { hashedIp },
        { hashedUA },
        { hashedDevice },
        { hashedEmailDomain },
        { institutionId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (potentialMatches.length > 0) {
    logger.warn(`[TRIAL AUDIT] ⚠️ Possible trial abuse detected for IP: ${ip}`);
    await recordAuditEvent({
      actorRole: "system",
      action: "TRIAL_ABUSE_DETECTED",
      details: { ip, email, matches: potentialMatches.length },
    });

    // Notify super admin if multiple matches or frequent attempts
    if (potentialMatches.length >= 2) {
      await superAdminAlertsService.sendAlert({
        category: "abuse",
        title: "Potential Trial Reuse Attempt",
        message: `Multiple accounts detected from same device/IP (${ip})`,
        severity: "high",
        metadata: { matches: potentialMatches },
      });
    }

    throw Errors.Forbidden(
      "Free trial already used from this device or network. Please purchase a plan to continue."
    );
  }
};

/* ------------------------------------------------------------------------
   🧾 Log new trial usage attempt
------------------------------------------------------------------------ */
export const logTrialUsage = async (
  userId: string,
  fingerprint: TrialFingerprint
) => {
  try {
    const hashedIp = generateHash(fingerprint.ip);
    const hashedUA = fingerprint.userAgent ? generateHash(fingerprint.userAgent) : null;
    const hashedDevice = fingerprint.deviceId
      ? generateHash(fingerprint.deviceId)
      : null;
    const hashedEmailDomain = fingerprint.email?.includes("@")
      ? generateHash(fingerprint.email.split("@")[1])
      : null;

    await prisma.trialAbuseLog.create({
      data: {
        userId,
        institutionId: fingerprint.institutionId ?? null,
        hashedIp,
        hashedUA,
        hashedDevice,
        hashedEmailDomain,
      },
    });

    logger.info(`[TRIAL AUDIT] Logged trial usage for ${userId} from IP ${fingerprint.ip}`);
  } catch (err: any) {
    logger.error(`[TRIAL AUDIT] Failed to log trial usage: ${err.message}`);
  }
};

/* ------------------------------------------------------------------------
   🧱 Enforce One-Trial Policy
------------------------------------------------------------------------ */
export const enforceOneTrialPolicy = async (
  userId: string,
  fingerprint: TrialFingerprint
) => {
  await detectTrialAbuse(fingerprint);
  await logTrialUsage(userId, fingerprint);
};

/* ------------------------------------------------------------------------
   🧹 Cleanup old logs (called by daily cron/worker)
------------------------------------------------------------------------ */
export const cleanupOldTrialLogs = async (days = 180) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const count = await prisma.trialAbuseLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (count.count > 0) {
    logger.info(`[TRIAL AUDIT] Cleaned up ${count.count} old trial logs`);
  }
};