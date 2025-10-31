// src/lib/securityManager.ts
/**
 * securityManager.ts (Enterprise Grade v3)
 * ----------------------------------------------------------
 * - Centralized cryptographic and policy enforcement
 * - Password & secret strength checks
 * - HMAC signing and verification
 * - Secure token + HSM-ready key derivation
 * - Super Admin key guard integration
 * - Breach check stubs (HIBP / internal)
 * - Cryptographic audit event builder
 */

import crypto from "crypto";
import bcrypt from "bcrypt";
import logger from "../logger";
import { config } from "../config";

/* ─────────────────────────────── */
/* 🔧 Configurable Security Params */
/* ─────────────────────────────── */
const DEFAULT_BCRYPT_ROUNDS = Number(config.bcryptRounds) || 12;
const MIN_PASSWORD_LEN = Number(config.minPasswordLength) || 10;
const TOKEN_DEFAULT_BYTES = 48;

/* ─────────────────────────────── */
/* 🔐 Password Strength Validator  */
/* ─────────────────────────────── */
export const validatePasswordPolicy = (password?: string) => {
  const reasons: string[] = [];

  if (!password || typeof password !== "string")
    return { valid: false, reasons: ["Password is required"] };

  if (password.length < MIN_PASSWORD_LEN)
    reasons.push(`Minimum length: ${MIN_PASSWORD_LEN} characters.`);

  if (!/[a-z]/.test(password)) reasons.push("Include at least one lowercase letter.");
  if (!/[A-Z]/.test(password)) reasons.push("Include at least one uppercase letter.");
  if (!/[0-9]/.test(password)) reasons.push("Include at least one number.");
  if (!/[^A-Za-z0-9]/.test(password))
    reasons.push("Include at least one symbol (e.g., @#$%).");

  const lower = password.toLowerCase();
  const weakPatterns = ["1234", "password", "qwerty", "abcd", "1111", "0000"];
  if (weakPatterns.some((p) => lower.includes(p)))
    reasons.push("Password contains easily guessable sequences.");

  return { valid: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
};

/* ─────────────────────────────── */
/* 🔑 Secure Hashing (bcrypt)      */
/* ─────────────────────────────── */
export const hashPassword = async (raw: string): Promise<string> => {
  const salt = await bcrypt.genSalt(DEFAULT_BCRYPT_ROUNDS);
  return bcrypt.hash(raw, salt);
};

export const comparePassword = async (raw: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(raw, hash);
  } catch (err) {
    logger.error("[SECURITY] Password comparison failed", err);
    return false;
  }
};

/* ─────────────────────────────── */
/* 🧠 Secure Token Generators      */
/* ─────────────────────────────── */
export const generateSecureToken = (bytes = TOKEN_DEFAULT_BYTES): string =>
  crypto.randomBytes(bytes).toString("hex");

export const createTimedToken = (ttlSeconds = 60 * 60 * 24) => ({
  token: generateSecureToken(),
  expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
});

/* ─────────────────────────────── */
/* 🧮 Secret & Entropy Validation  */
/* ─────────────────────────────── */
export const isSecretStrong = (secret?: string): boolean => {
  if (!secret || secret.length < 32) return false;
  const checks = [
    /[a-z]/.test(secret),
    /[A-Z]/.test(secret),
    /[0-9]/.test(secret),
    /[^A-Za-z0-9]/.test(secret),
  ];
  return checks.every(Boolean);
};

/* ─────────────────────────────── */
/* 🧩 Optional Breach Checker Stub */
/* ─────────────────────────────── */
export const checkPasswordBreach = async (
  passwordOrHash: string,
  checker: (value: string) => Promise<boolean>
): Promise<{ breached: boolean; provider?: string } | null> => {
  try {
    const breached = await checker(passwordOrHash);
    return { breached, provider: "custom" };
  } catch (err) {
    logger.error("[SECURITY] breach check failed", err);
    return null;
  }
};

/* ─────────────────────────────── */
/* 🕶️ Masking & Sanitization      */
/* ─────────────────────────────── */
export const mask = (
  s: string | undefined | null,
  visibleStart = 3,
  visibleEnd = 3
): string | undefined | null => {
  if (!s) return s;
  if (s.length <= visibleStart + visibleEnd) return "*".repeat(s.length);
  return `${s.slice(0, visibleStart)}${"*".repeat(s.length - visibleStart - visibleEnd)}${s.slice(-visibleEnd)}`;
};

/* ─────────────────────────────── */
/* ⏱️ Rate-Limit Key Helper        */
/* ─────────────────────────────── */
export const rateLimitKey = (prefix: string, id: string) => `rl:${prefix}:${id}`;

/* ─────────────────────────────── */
/* 🧾 Cryptographic Audit Entry    */
/* ─────────────────────────────── */
export const buildAuditEntry = (
  actorId: string | null,
  action: string,
  details: Record<string, any> = {}
) => {
  const clean = JSON.parse(JSON.stringify(details));
  const sensitiveFields = ["password", "token", "accessToken", "refreshToken", "email", "key"];
  for (const f of Object.keys(clean)) {
    if (sensitiveFields.includes(f) && typeof clean[f] === "string") clean[f] = mask(clean[f]);
  }

  const serialized = JSON.stringify(clean);
  const signature = crypto
    .createHmac("sha256", config.hmacSecret || "audit-default")
    .update(serialized)
    .digest("hex");

  return {
    timestamp: new Date().toISOString(),
    actorId: actorId || "system",
    action,
    details: clean,
    signature,
  };
};

/* ─────────────────────────────── */
/* ✍️ HMAC Signing / Verification  */
/* ─────────────────────────────── */
export const signHmac = (payload: string, secret?: string) => {
  const key = secret || config.hmacSecret || process.env.HMAC_SECRET;
  if (!key) throw new Error("HMAC secret not configured");
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
};

export const verifyHmac = (payload: string, signature: string, secret?: string): boolean => {
  const expected = signHmac(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

/* ─────────────────────────────── */
/* 🧠 Super Admin Guard Utility    */
/* ─────────────────────────────── */
export const ensureSuperAdmin = (role?: string) => {
  if (!role || role.toLowerCase() !== "superadmin") {
    throw new Error("Access denied: Super Admin privileges required.");
  }
};

/* ─────────────────────────────── */
/* ⚙️ Startup Secret Validation    */
/* ─────────────────────────────── */
export const assertCriticalSecrets = () => {
  const weak: string[] = [];

  if (!isSecretStrong(process.env.JWT_SECRET)) weak.push("JWT_SECRET");
  if (!isSecretStrong(process.env.REFRESH_TOKEN_SECRET)) weak.push("REFRESH_TOKEN_SECRET");
  if (process.env.HMAC_SECRET && !isSecretStrong(process.env.HMAC_SECRET)) weak.push("HMAC_SECRET");

  if (weak.length > 0) {
    logger.warn(
      `[SECURITY] Weak secrets detected: ${weak.join(", ")}. Rotate immediately with ≥32-char high-entropy keys.`
    );
  } else {
    logger.info("[SECURITY] ✅ Critical secrets validated as strong.");
  }
};

/* ─────────────────────────────── */
/* 🌐 Export Default Manager       */
/* ─────────────────────────────── */
export default {
  validatePasswordPolicy,
  hashPassword,
  comparePassword,
  generateSecureToken,
  createTimedToken,
  isSecretStrong,
  checkPasswordBreach,
  mask,
  rateLimitKey,
  buildAuditEntry,
  signHmac,
  verifyHmac,
  ensureSuperAdmin,
  assertCriticalSecrets,
};