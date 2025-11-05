// src/services/trialAudit.service.ts
/**
 * Trial Abuse & Invitation Abuse Audit Service (Enterprise Edition)
 * -----------------------------------------------------------------
 * Prevents:
 *   - Reuse of free trials across devices/IPs/institutions
 *   - Invitation abuse (spam or fake signups)
 *   - Device/IP-level fraud or cycling behavior
 *
 * Integrations:
 *   - prisma (trialAbuseLog, invitation)
 *   - auditService
 *   - ipBlockService
 *   - superAdminAlertsService
 *   - logger
 *
 * Security:
 *   - SHA-256 hashed identifiers (privacy-safe)
 *   - Confidence scoring for false-positive prevention
 *   - Dynamic alert severity
 */

import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { superAdminAlertsService } from "./superAdminAlerts.service";
import { recordAuditEvent } from "./audit.service";
import { ipBlockService } from "./ipBlock.service";

/* ----------------------------------------------------------------
   🔧 Configurable Limits & Constants
------------------------------------------------------------------ */
const INVITE_LIMIT_PER_DAY = Number(process.env.INVITE_LIMIT_PER_DAY || 10);
const TRIAL_MATCH_THRESHOLD = Number(process.env.TRIAL_MATCH_THRESHOLD || 2);
const BLOCK_DURATION_HOURS = Number(process.env.BLOCK_DURATION_HOURS || 12);

type Fingerprint = {
  ip: string;
  userAgent?: string;
  deviceId?: string;
  email?: string;
  institutionId?: string;
};

/* ----------------------------------------------------------------
   🔒 Hash Utility (privacy-safe)
------------------------------------------------------------------ */
const hash = (val?: string) =>
  val ? crypto.createHash("sha256").update(val.trim().toLowerCase()).digest("hex") : null;

/* ----------------------------------------------------------------
   🚨 Detect Trial or Invite Abuse (with scoring)
------------------------------------------------------------------ */
export const detectTrialAbuse = async (fingerprint: Fingerprint) => {
  const { ip, userAgent, email, deviceId, institutionId } = fingerprint;
  const hashedIp = hash(ip);
  const hashedUA = hash(userAgent);
  const hashedDevice = hash(deviceId);
  const hashedEmailDomain = email?.includes("@") ? hash(email.split("@")[1]) : null;

  const matches = await prisma.trialAbuseLog.findMany({
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
    take: 20,
  });

  let score = 0;
  if (matches.some((m) => m.hashedIp === hashedIp)) score += 3;
  if (matches.some((m) => m.hashedDevice === hashedDevice)) score += 4;
  if (matches.some((m) => m.hashedEmailDomain === hashedEmailDomain)) score += 2;
  if (matches.some((m) => m.institutionId === institutionId)) score += 1;

  const severity = score >= 8 ? "critical" : score >= 6 ? "high" : score >= 4 ? "medium" : "low";

  if (matches.length > 0 && score >= 4) {
    logger.warn(`[TRIAL AUDIT] ⚠️ ${matches.length} similar entries detected. Score: ${score}`);

    await recordAuditEvent({
      actorRole: "system",
      action: "TRIAL_ABUSE_DETECTED",
      details: { ip, matches: matches.length, institutionId, score },
    });

    if (score >= 6 || matches.length >= TRIAL_MATCH_THRESHOLD) {
      await ipBlockService.blockTemporary(
        ip,
        "Repeated trial/invite abuse detected",
        3600 * BLOCK_DURATION_HOURS
      );

      await superAdminAlertsService.sendAlert({
        category: "abuse",
        title: "Trial or Invite Abuse Detected",
        message: `Detected suspicious trial activity (score: ${score}) from ${ip}`,
        severity,
        metadata: { ip, score, matches },
      });
    }

    throw Errors.Forbidden(
      "Multiple trial or invitation attempts detected from this device or network. Please contact support or upgrade your plan."
    );
  }
};

/* ----------------------------------------------------------------
   🧾 Log Trial Usage (Legitimate Signups)
------------------------------------------------------------------ */
export const logTrialUsage = async (userId: string, fingerprint: Fingerprint) => {
  try {
    await prisma.trialAbuseLog.create({
      data: {
        userId,
        institutionId: fingerprint.institutionId ?? null,
        hashedIp: hash(fingerprint.ip)!,
        hashedUA: hash(fingerprint.userAgent),
        hashedDevice: hash(fingerprint.deviceId),
        hashedEmailDomain: fingerprint.email?.includes("@")
          ? hash(fingerprint.email.split("@")[1])
          : null,
        eventType: "TRIAL_USAGE",
      },
    });
    logger.info(`[TRIAL AUDIT] Logged trial usage for ${userId} from ${fingerprint.ip}`);
  } catch (err: any) {
    logger.error(`[TRIAL AUDIT] Failed to log trial usage: ${err.message}`);
  }
};

/* ----------------------------------------------------------------
   📬 Record Invitation Attempt (Spam & Abuse Control)
------------------------------------------------------------------ */
export const recordInviteAttempt = async (data: {
  inviterId: string;
  inviterRole: string;
  email: string;
  ip: string;
  userAgent: string;
  time: Date;
}) => {
  const hashedIp = hash(data.ip);
  const hashedUA = hash(data.userAgent);
  const hashedEmailDomain = data.email.includes("@")
    ? hash(data.email.split("@")[1])
    : null;

  try {
    const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.invitation.count({
      where: { invitedById: data.inviterId, createdAt: { gt: lastDay } },
    });

    if (recentCount >= INVITE_LIMIT_PER_DAY) {
      await ipBlockService.blockTemporary(
        data.ip,
        "Excessive invitation attempts",
        3600
      );

      await superAdminAlertsService.sendAlert({
        category: "abuse",
        title: "Invitation Abuse Detected",
        message: `${data.inviterRole} exceeded safe invite limit (${INVITE_LIMIT_PER_DAY}/24h).`,
        severity: "medium",
        metadata: { inviterId: data.inviterId, ip: data.ip, count: recentCount },
      });

      throw Errors.Forbidden("You’ve exceeded the safe invitation limit for today.");
    }

    await prisma.trialAbuseLog.create({
      data: {
        userId: data.inviterId,
        hashedIp,
        hashedUA,
        hashedEmailDomain,
        eventType: "INVITE_ATTEMPT",
      },
    });

    logger.info(`[TRIAL AUDIT] Invite attempt recorded for ${data.inviterId} (${data.email})`);
  } catch (err: any) {
    logger.error(`[TRIAL AUDIT] recordInviteAttempt failed: ${err.message}`);
  }
};

/* ----------------------------------------------------------------
   🚷 Enforce One-Trial Policy (Main Entry)
------------------------------------------------------------------ */
export const enforceOneTrialPolicy = async (userId: string, fingerprint: Fingerprint) => {
  await detectTrialAbuse(fingerprint);
  await logTrialUsage(userId, fingerprint);
};

/* ----------------------------------------------------------------
   🧹 Cleanup (Maintenance Task)
------------------------------------------------------------------ */
export const cleanupOldTrialLogs = async (days = 180) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await prisma.trialAbuseLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (deleted.count > 0) {
    logger.info(`[TRIAL AUDIT] Cleaned ${deleted.count} old logs`);
  }
};