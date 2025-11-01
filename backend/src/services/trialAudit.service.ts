// src/services/trialAudit.service.ts
/**
 * Trial Abuse & Invitation Abuse Audit Service (Hardened Version)
 * ---------------------------------------------------------------
 * Detects and prevents:
 *   - Reuse of free trial accounts
 *   - Excessive or repeated invitation abuse (spam or fake onboarding)
 *   - Device/IP-level fraud or cycling
 *
 * Integrations:
 *   - prisma (trialAbuseLog table)
 *   - auditService
 *   - ipBlockService (auto temporary ban)
 *   - superAdminAlertsService (for escalations)
 */

import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { superAdminAlertsService } from "./superAdminAlerts.service";
import { recordAuditEvent } from "./audit.service";
import { ipBlockService } from "./ipBlock.service";

type Fingerprint = {
  ip: string;
  userAgent?: string;
  deviceId?: string;
  email?: string;
  institutionId?: string;
};

/* ------------------------------------------------------------
   🔒 Hash utility (privacy-safe)
------------------------------------------------------------- */
const hash = (val?: string) =>
  val ? crypto.createHash("sha256").update(val.trim().toLowerCase()).digest("hex") : null;

/* ------------------------------------------------------------
   🚨 Detect Trial or Invite Abuse
------------------------------------------------------------- */
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
    take: 10,
  });

  if (matches.length > 0) {
    logger.warn(`[TRIAL AUDIT] ⚠️ Detected ${matches.length} similar past entries for IP ${ip}`);

    await recordAuditEvent({
      actorRole: "system",
      action: "TRIAL_ABUSE_DETECTED",
      details: { ip, matches: matches.length, institutionId },
    });

    // 🔥 Escalate repeated offenders
    if (matches.length >= 2) {
      await ipBlockService.blockTemporary(ip, "Repeated trial/invite abuse detected", 3600 * 12);
      await superAdminAlertsService.sendAlert({
        category: "abuse",
        title: "Trial or Invite Abuse Detected",
        message: `Detected ${matches.length} similar usage attempts from ${ip}`,
        severity: "high",
        metadata: { ip, matches },
      });
    }

    throw Errors.Forbidden(
      "Multiple trial or invitation attempts detected from this device or network. Please contact support or upgrade your plan."
    );
  }
};

/* ------------------------------------------------------------
   🧾 Log trial usage (for new legitimate users)
------------------------------------------------------------- */
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
      },
    });

    logger.info(`[TRIAL AUDIT] Logged trial usage for ${userId} from ${fingerprint.ip}`);
  } catch (err: any) {
    logger.error(`[TRIAL AUDIT] Failed to log trial usage: ${err.message}`);
  }
};

/* ------------------------------------------------------------
   📬 Record Invitation Attempt (by coach or admin)
   Prevents invitation spam or repeated fake invites
------------------------------------------------------------- */
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
    // Count similar invites from same IP within last 24h
    const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.invitation.count({
      where: {
        invitedById: data.inviterId,
        createdAt: { gt: lastDay },
      },
    });

    if (recentCount >= 10) {
      await ipBlockService.blockTemporary(data.ip, "Excessive invitation attempts", 3600);
      await superAdminAlertsService.sendAlert({
        category: "abuse",
        title: "Invitation Abuse Detected",
        message: `${data.inviterRole} exceeded safe invite limit (10/24h).`,
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

/* ------------------------------------------------------------
   🚷 Enforce one trial per device/network
------------------------------------------------------------- */
export const enforceOneTrialPolicy = async (userId: string, fingerprint: Fingerprint) => {
  await detectTrialAbuse(fingerprint);
  await logTrialUsage(userId, fingerprint);
};

/* ------------------------------------------------------------
   🧹 Cleanup (cron job)
------------------------------------------------------------- */
export const cleanupOldTrialLogs = async (days = 180) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await prisma.trialAbuseLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (deleted.count > 0) {
    logger.info(`[TRIAL AUDIT] Cleaned ${deleted.count} old logs`);
  }
};