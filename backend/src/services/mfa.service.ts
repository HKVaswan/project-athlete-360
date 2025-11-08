/**
 * src/services/mfa.service.ts
 * --------------------------------------------------------------------------
 * 🛡️ Enterprise MFA Service
 *
 * Capabilities:
 *  - TOTP (Authenticator apps) generation & verification (otplib)
 *  - One-time SMS / Email OTP challenge (pluggable providers)
 *  - Recovery codes (hashed, single-use)
 *  - Durable storage via Prisma (userMfa table expected)
 *  - Rate-limiting, audit logging, telemetry integration
 *  - Express middleware helper to enforce MFA on sensitive flows
 * --------------------------------------------------------------------------
 */

import crypto from "crypto";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { redisClient } from "../lib/redisClient";
import { auditService } from "./audit.service";
import { logger } from "../logger";
import { config } from "../config";
import prisma from "../prismaClient";
import { recordError } from "../lib/core/metrics";

const redis = redisClient();

/* --------------------------------------------------------------------------
   Types
-------------------------------------------------------------------------- */
type MfaMethod = "totp" | "sms" | "email";
type UserMfaRecord = {
  userId: string;
  enabled: boolean;
  methods: MfaMethod[];
  totpSecret?: string | null; // base32 secret
  recoveryHashes?: string[]; // sha256 hashes
  phone?: string | null;
  email?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/* --------------------------------------------------------------------------
   Configurable parameters (tunable)
-------------------------------------------------------------------------- */
const OTP_TTL_SEC = Number(process.env.MFA_OTP_TTL_SEC ?? 300); // 5 minutes
const OTP_RATE_LIMIT_WINDOW_SEC = Number(process.env.MFA_RATE_WINDOW_SEC ?? 60);
const OTP_RATE_LIMIT_MAX = Number(process.env.MFA_RATE_MAX ?? 5);
const RECOVERY_CODES_COUNT = Number(process.env.MFA_RECOVERY_CODES ?? 8);
const RECOVERY_CODE_LENGTH = Number(process.env.MFA_RECOVERY_CODE_LENGTH ?? 12);

/* --------------------------------------------------------------------------
   Utility helpers
-------------------------------------------------------------------------- */

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateRandomCode(len = RECOVERY_CODE_LENGTH) {
  // base36 is lower-case + digits — good for human copy
  return crypto.randomBytes(Math.ceil(len * 0.6)).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, len);
}

/* --------------------------------------------------------------------------
   Rate limiting helper for sending OTPs (simple Redis fixed-window)
-------------------------------------------------------------------------- */
async function checkAndIncrementOtpRate(userKey: string) {
  try {
    const key = `mfa:rate:${userKey}`;
    const tx = (redis as any).multi();
    tx.incr(key);
    tx.ttl(key);
    const res = await tx.exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    let ttl = Number(res?.[1]?.[1] ?? -1);

    if (ttl === -1) {
      await redis.expire(key, OTP_RATE_LIMIT_WINDOW_SEC);
      ttl = OTP_RATE_LIMIT_WINDOW_SEC;
    }

    return { count, ttl };
  } catch (err: any) {
    logger.warn("[MFA] Rate check failed, allowing by default:", err.message);
    return { count: 0, ttl: OTP_RATE_LIMIT_WINDOW_SEC };
  }
}

/* --------------------------------------------------------------------------
   Storage helpers (Prisma-backed, tolerant if schema missing)
-------------------------------------------------------------------------- */

async function upsertUserMfa(userId: string, data: Partial<UserMfaRecord>) {
  try {
    // Expecting Prisma model `userMfa` with unique `userId`
    return await prisma.userMfa.upsert({
      where: { userId },
      create: { userId, ...data } as any,
      update: { ...data } as any,
    });
  } catch (err: any) {
    // Prisma schema may differ — fall back to direct user table updates if possible
    logger.warn("[MFA] upsert userMfa failed, schema may be missing:", err.message);
    throw err;
  }
}

async function getUserMfaRecord(userId: string): Promise<UserMfaRecord | null> {
  try {
    const rec = await prisma.userMfa.findUnique({ where: { userId } });
    return rec as any;
  } catch (err: any) {
    logger.warn("[MFA] getUserMfaRecord failed (schema?), falling back:", err.message);
    return null;
  }
}

/* --------------------------------------------------------------------------
   TOTP (Authenticator app) helpers
-------------------------------------------------------------------------- */

export async function generateTOTPSecretForUser(userId: string, label?: string) {
  // Generate secret
  const secret = authenticator.generateSecret(); // base32
  const otpauth = authenticator.keyuri(label || `${userId}`, config.serviceName || "pa360", secret);

  // Optionally produce QR data URL
  const qr = await qrcode.toDataURL(otpauth).catch(() => null);

  // Persist secret as disabled until user verifies it
  try {
    await upsertUserMfa(userId, {
      totpSecret: secret,
      enabled: false,
      methods: ["totp"],
    });
    await auditService.log({
      actorId: userId,
      actorRole: "user",
      action: "MFA_TOTP_SECRET_GENERATED",
      details: { method: "totp" },
    });
  } catch (err: any) {
    logger.error("[MFA] Failed to persist TOTP secret:", err.message);
    recordError("mfa_persist_error", "medium");
    throw err;
  }

  return { secret, otpauth, qr };
}

export async function verifyTOTP(userId: string, token: string) {
  const rec = await getUserMfaRecord(userId);
  if (!rec || !rec.totpSecret) {
    throw new Error("TOTP not configured for user.");
  }

  // verify with small window allowance
  const isValid = authenticator.check(token, rec.totpSecret);
  if (isValid) {
    // ensure enabled flag set
    if (!rec.enabled) {
      await upsertUserMfa(userId, { enabled: true });
      await auditService.log({
        actorId: userId,
        actorRole: "user",
        action: "MFA_TOTP_ENABLED",
        details: {},
      });
    }
    return true;
  } else {
    return false;
  }
}

/* --------------------------------------------------------------------------
   Recovery codes generation / verification
-------------------------------------------------------------------------- */
export async function generateRecoveryCodes(userId: string) {
  const codes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
    const code = generateRandomCode();
    codes.push(code);
    hashes.push(sha256Hex(code));
  }

  // store hashed codes
  await upsertUserMfa(userId, { recoveryHashes: hashes });
  await auditService.log({
    actorId: userId,
    actorRole: "user",
    action: "MFA_RECOVERY_CODES_GENERATED",
    details: { count: RECOVERY_CODES_COUNT },
  });

  // return plain codes to user once (they must copy/store securely)
  return codes;
}

export async function verifyAndConsumeRecoveryCode(userId: string, code: string) {
  const rec = await getUserMfaRecord(userId);
  if (!rec || !rec.recoveryHashes || rec.recoveryHashes.length === 0) return false;

  const hash = sha256Hex(code);
  const idx = rec.recoveryHashes.findIndex((h) => h === hash);
  if (idx === -1) return false;

  // consume the code (remove from stored hashes)
  const newHashes = rec.recoveryHashes.slice();
  newHashes.splice(idx, 1);
  await upsertUserMfa(userId, { recoveryHashes: newHashes });
  await auditService.log({
    actorId: userId,
    actorRole: "user",
    action: "MFA_RECOVERY_CODE_CONSUMED",
    details: { method: "recovery_code" },
  });
  return true;
}

/* --------------------------------------------------------------------------
   Short OTP via SMS / Email (challenge flow)
   - Stores the OTP in Redis keyed per-challenge (ttl)
-------------------------------------------------------------------------- */

async function sendOtpToProvider({
  channel,
  destination,
  code,
  meta,
}: {
  channel: "sms" | "email";
  destination: string;
  code: string;
  meta?: Record<string, any>;
}) {
  // pluggable providers configured via config.mfa.smsProvider / config.mfa.emailProvider
  if (channel === "sms") {
    const sendSms = (config.mfa && (config.mfa as any).smsProvider) as
      | ((to: string, msg: string, meta?: any) => Promise<any>)
      | undefined;
    if (!sendSms) throw new Error("SMS provider not configured");
    return sendSms(destination, `Your Project Athlete 360 OTP: ${code}`, meta);
  } else {
    const sendEmail = (config.mfa && (config.mfa as any).emailProvider) as
      | ((to: string, subject: string, body: string, meta?: any) => Promise<any>)
      | undefined;
    if (!sendEmail) throw new Error("Email provider not configured");
    return sendEmail(destination, "Your Project Athlete 360 OTP", `Your OTP is ${code}`, meta);
  }
}

export async function createOtpChallenge(userId: string, channel: "sms" | "email") {
  // Validate user contact details
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, email: true } });
  if (!user) throw new Error("User not found");

  const dest = channel === "sms" ? user.phone : user.email;
  if (!dest) throw new Error(`${channel} not available for user`);

  // Rate limit per user
  const { count, ttl } = await checkAndIncrementOtpRate(`user:${userId}:${channel}`);
  if (count > OTP_RATE_LIMIT_MAX) {
    logger.warn(`[MFA] OTP rate limit exceeded for user ${userId} (${channel})`);
    await auditService.log({
      actorId: userId,
      actorRole: "user",
      action: "MFA_OTP_RATE_LIMIT",
      details: { count, window: OTP_RATE_LIMIT_WINDOW_SEC },
    });
    throw new Error("Too many OTP requests. Try again later.");
  }

  // generate numeric OTP (6 digits)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const challengeKey = `mfa:otp:${userId}:${channel}`;

  // store hashed value in redis with ttl
  await redis.setex(challengeKey, OTP_TTL_SEC, sha256Hex(code));
  await sendOtpToProvider({ channel, destination: dest as string, code, meta: { userId } });

  await auditService.log({
    actorId: userId,
    actorRole: "user",
    action: "MFA_OTP_SENT",
    details: { channel, ttl: OTP_TTL_SEC },
  });

  return { ttl: OTP_TTL_SEC };
}

export async function verifyOtpChallenge(userId: string, channel: "sms" | "email", code: string) {
  const challengeKey = `mfa:otp:${userId}:${channel}`;
  const storedHash = await redis.get(challengeKey);
  if (!storedHash) return false;
  const ok = storedHash === sha256Hex(code);
  if (ok) {
    await redis.del(challengeKey);
    await auditService.log({
      actorId: userId,
      actorRole: "user",
      action: "MFA_OTP_VERIFIED",
      details: { channel },
    });
  } else {
    await auditService.log({
      actorId: userId,
      actorRole: "user",
      action: "MFA_OTP_FAILED",
      details: { channel },
    });
  }
  return ok;
}

/* --------------------------------------------------------------------------
   Public helper to enable/disable MFA for a user
-------------------------------------------------------------------------- */

export async function enableMfa(userId: string, methods: MfaMethod[] = ["totp"]) {
  const rec = await getUserMfaRecord(userId);
  const payload: Partial<UserMfaRecord> = { enabled: true, methods };

  // If enabling totp and secret missing -> generate
  if (methods.includes("totp") && (!rec || !rec.totpSecret)) {
    const { secret } = await generateTOTPSecretForUser(userId, `${config.serviceName}:${userId}`);
    payload.totpSecret = secret;
  }

  await upsertUserMfa(userId, payload);
  await auditService.log({
    actorId: userId,
    actorRole: "user",
    action: "MFA_ENABLED",
    details: { methods },
  });

  return true;
}

export async function disableMfa(userId: string) {
  await upsertUserMfa(userId, { enabled: false, methods: [] });
  await auditService.log({
    actorId: userId,
    actorRole: "user",
    action: "MFA_DISABLED",
    details: {},
  });
  return true;
}

/* --------------------------------------------------------------------------
   Check whether MFA should be required for a user or route
   (e.g., enforce for admins or for sensitive actions)
-------------------------------------------------------------------------- */
export function isMfaRequiredForUser(user: any) {
  // enforce for super_admin / admin roles automatically
  if (!user) return false;
  if (["super_admin", "admin"].includes(user.role)) return true;
  // otherwise decide by tenant policy (example)
  const tenantPolicy = (user.tenantSettings && user.tenantSettings.enforceMfa) || false;
  return !!tenantPolicy;
}

/* --------------------------------------------------------------------------
   Express middleware to require MFA if not yet verified in session
   - Expects `req.user` to exist from authentication middleware
   - Checks `req.session.mfaVerified` or validates one-time challenge in request body
-------------------------------------------------------------------------- */
import { Request, Response, NextFunction } from "express";

export const requireMfaMiddleware = (opts?: { allowRecovery?: boolean }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

      // If user is required to have MFA, but not enabled -> block
      const rec = await getUserMfaRecord(user.id);
      if (isMfaRequiredForUser(user) && (!rec || !rec.enabled)) {
        return res.status(403).json({ success: false, message: "MFA required for this account" });
      }

      // If session already has mfaVerified flag true -> proceed
      if ((req as any).session?.mfaVerified) return next();

      // Accept verification inline: totp, otp, recovery
      const { totp, otp, recoveryCode } = req.body || {};

      if (totp) {
        const ok = await verifyTOTP(user.id, String(totp));
        if (ok) {
          (req as any).session = (req as any).session || {};
          (req as any).session.mfaVerified = true;
          return next();
        }
      }

      if (otp) {
        const ok = await verifyOtpChallenge(user.id, "sms", String(otp)).catch(() => false);
        if (!ok) {
          // also try email channel
          const ok2 = await verifyOtpChallenge(user.id, "email", String(otp)).catch(() => false);
          if (ok2) {
            (req as any).session = (req as any).session || {};
            (req as any).session.mfaVerified = true;
            return next();
          }
        } else {
          (req as any).session = (req as any).session || {};
          (req as any).session.mfaVerified = true;
          return next();
        }
      }

      if (recoveryCode && opts?.allowRecovery) {
        const ok = await verifyAndConsumeRecoveryCode(user.id, String(recoveryCode));
        if (ok) {
          (req as any).session = (req as any).session || {};
          (req as any).session.mfaVerified = true;
          return next();
        }
      }

      // If none matched, ask client to perform MFA challenge
      return res.status(403).json({
        success: false,
        message: "MFA verification required",
        requiredMethods: rec?.methods || ["totp"],
      });
    } catch (err: any) {
      logger.error("[MFA] requireMfaMiddleware error:", err.message);
      return res.status(500).json({ success: false, message: "MFA service error" });
    }
  };
};

/* --------------------------------------------------------------------------
   Small utility: session-safe cleanup (revoke flags)
-------------------------------------------------------------------------- */
export async function revokeSessionMfaFlag(sessionId: string) {
  try {
    const key = `session:mfa:${sessionId}`;
    await redis.del(key);
  } catch (err: any) {
    logger.debug("[MFA] revokeSessionMfaFlag error:", err.message);
  }
}

/* --------------------------------------------------------------------------
   Export public API
-------------------------------------------------------------------------- */
export default {
  generateTOTPSecretForUser,
  verifyTOTP,
  generateRecoveryCodes,
  verifyAndConsumeRecoveryCode,
  createOtpChallenge,
  verifyOtpChallenge,
  enableMfa,
  disableMfa,
  isMfaRequiredForUser,
  requireMfaMiddleware,
  revokeSessionMfaFlag,
};