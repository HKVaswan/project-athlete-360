// src/lib/securityManager.ts
/**
 * securityManager.ts
 *
 * Enterprise-grade security utilities and guards.
 * - Password policy enforcement + helpers
 * - Secure token generation (cryptographically secure)
 * - Hashing wrapper (bcrypt, centralised salt/rounds)
 * - Secret strength checks
 * - Pluggable external breach-check (HIBP) / hack-db integration
 * - Helpers for rate-limit keys / audit-safe masking
 *
 * NOTE: This module keeps all security logic in one place so controllers/services
 * can depend on consistent, auditable behavior.
 */

import crypto from "crypto";
import bcrypt from "bcrypt";
import logger from "../logger";
import { config } from "../config";

export type PasswordCheckResult = {
  valid: boolean;
  reasons?: string[]; // why invalid
};

const DEFAULT_BCRYPT_ROUNDS = Number(config.bcryptRounds) || 12;
const MIN_PASSWORD_LEN = Number(config.minPasswordLength) || 10;

/**
 * Validate password against policy:
 * - Minimum length (default 10)
 * - Mixed case (upper + lower)
 * - Digit required
 * - Symbol required
 * - Not obviously common sequences
 */
export const validatePasswordPolicy = (password?: string): PasswordCheckResult => {
  const reasons: string[] = [];
  if (!password || typeof password !== "string") {
    return { valid: false, reasons: ["Password is required"] };
  }

  if (password.length < MIN_PASSWORD_LEN) {
    reasons.push(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
  }
  if (!/[a-z]/.test(password)) reasons.push("Include at least one lowercase letter.");
  if (!/[A-Z]/.test(password)) reasons.push("Include at least one uppercase letter.");
  if (!/[0-9]/.test(password)) reasons.push("Include at least one digit.");
  if (!/[^A-Za-z0-9]/.test(password)) reasons.push("Include at least one symbol (e.g. !@#$).");

  // reject simple patterns (yyyy, 1234, qwerty)
  const lowered = password.toLowerCase();
  const simplePatterns = ["1234", "password", "qwerty", "abcd", "1111", "0000"];
  if (simplePatterns.some((p) => lowered.includes(p))) {
    reasons.push("Password is too common or contains simple sequences.");
  }

  return { valid: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
};

/**
 * Hash a password using bcrypt with configured rounds.
 * Central wrapper - use this everywhere for consistent hashing.
 */
export const hashPassword = async (raw: string): Promise<string> => {
  const rounds = DEFAULT_BCRYPT_ROUNDS;
  const salt = await bcrypt.genSalt(rounds);
  const hash = await bcrypt.hash(raw, salt);
  return hash;
};

/**
 * Compare password safely.
 */
export const comparePassword = async (raw: string, hash: string): Promise<boolean> => {
  try {
    return await bcrypt.compare(raw, hash);
  } catch (err) {
    logger.error("[SECURITY] bcrypt compare error", err);
    return false;
  }
};

/**
 * Generate a cryptographically secure random token (hex).
 * Suitable for refresh tokens, invite tokens, password reset tokens.
 * lengthBytes defaults to 48 (96 hex chars).
 */
export const generateSecureToken = (lengthBytes = 48): string => {
  return crypto.randomBytes(lengthBytes).toString("hex");
};

/**
 * Create a time-bound token structure for convenience.
 */
export const createTimedToken = (ttlSeconds = 60 * 60 * 24) => {
  const token = generateSecureToken();
  return {
    token,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
};

/**
 * Basic secret strength test (for JWT secret, API keys). Returns true when
 * secret is reasonably long and mixed.
 */
export const isSecretStrong = (secret?: string): boolean => {
  if (!secret || secret.length < 32) return false;
  // must contain at least one upper, lower, digit and symbol
  const checks = [
    /[a-z]/.test(secret),
    /[A-Z]/.test(secret),
    /[0-9]/.test(secret),
    /[^A-Za-z0-9]/.test(secret),
  ];
  return checks.every(Boolean);
};

/**
 * Pluggable check against breach databases (HaveIBeenPwned or internal).
 * NOTE: This function is a stub that calls a provided checker function (recommended).
 * The checker should return true if the password/hash was found leaked.
 *
 * Example:
 *   const leaked = await checkPasswordBreach(password, async (p) => {
 *     // call HIBP or internal service
 *   });
 */
export const checkPasswordBreach = async (
  passwordOrHash: string,
  checker: (value: string) => Promise<boolean>
): Promise<{ breached: boolean; provider?: string } | null> => {
  if (typeof checker !== "function") return null;
  try {
    const breached = await checker(passwordOrHash);
    return { breached, provider: "custom" };
  } catch (err) {
    logger.error("[SECURITY] breach check failed", err);
    return null;
  }
};

/**
 * Mask sensitive strings for logs and responses.
 * Keep first and last N chars visible by default.
 */
export const mask = (s: string | undefined | null, visibleStart = 4, visibleEnd = 4) => {
  if (!s) return s;
  if (s.length <= visibleStart + visibleEnd) return "*".repeat(Math.max(1, s.length));
  const start = s.slice(0, visibleStart);
  const end = s.slice(-visibleEnd);
  return `${start}${"*".repeat(s.length - visibleStart - visibleEnd)}${end}`;
};

/**
 * Rate-limit key helpers (pluggable with Redis)
 * - prefix: string (e.g., 'login', 'register')
 * - id: userId|ip|email
 */
export const rateLimitKey = (prefix: string, id: string) => {
  return `rl:${prefix}:${id}`;
};

/**
 * Audit helper to generate a safe event snippet (does not leak secrets).
 */
export const buildAuditEntry = (actorId: string | null, action: string, details: any = {}) => {
  const safeDetails = JSON.parse(JSON.stringify(details || {}));
  // mask any field that looks like token/password/email
  const maskFields = ["password", "token", "accessToken", "refreshToken", "email"];
  for (const k of Object.keys(safeDetails)) {
    if (maskFields.includes(k) && typeof safeDetails[k] === "string") {
      safeDetails[k] = mask(safeDetails[k]);
    }
  }
  return {
    timestamp: new Date().toISOString(),
    actorId: actorId ?? "system",
    action,
    details: safeDetails,
    env: config.nodeEnv || "development",
  };
};

/**
 * Simple HMAC helper for signing small payloads (optional layer).
 * Use a strong secret (config.HMAC_SECRET).
 */
export const signHmac = (payload: string, secret?: string) => {
  const key = secret || config.hmacSecret || process.env.HMAC_SECRET;
  if (!key) throw new Error("HMAC secret not configured");
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
};

/**
 * Small helper to verify that critical environment secrets are strong.
 * Runs at startup (call from server bootstrap).
 */
export const assertCriticalSecrets = () => {
  const weak: string[] = [];
  if (!isSecretStrong(process.env.JWT_SECRET)) weak.push("JWT_SECRET");
  if (!isSecretStrong(process.env.REFRESH_TOKEN_SECRET)) weak.push("REFRESH_TOKEN_SECRET");
  // HMAC is optional
  if (process.env.HMAC_SECRET && !isSecretStrong(process.env.HMAC_SECRET)) weak.push("HMAC_SECRET");

  if (weak.length > 0) {
    logger.warn(
      `[SECURITY] Weak secrets detected: ${weak.join(
        ", "
      )}. It's strongly recommended to rotate and use high-entropy keys (>=32 chars).`
    );
  } else {
    logger.info("[SECURITY] Critical secrets appear to be strong.");
  }
};

/**
 * Expose configuration-sensitive helpers so services/controllers can integrate
 * with Redis or other external stores for rate-limiting or breach-caching.
 */
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
  assertCriticalSecrets,
};