/**
 * src/utils/assertCriticalSecrets.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise-Grade Secret Assertion Utility (v2)
 *
 * Features:
 *   - Ensures all critical secrets exist and are strong before boot
 *   - Multi-layer entropy, pattern, and length checks
 *   - Integrates with SecretsManager + AuditService
 *   - Sends alert + halts startup if critical issues detected
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import secretsManager from "../config/secretsManager";
import { auditService } from "../services/audit.service";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";

/* -------------------------------------------------------------------------- */
/* 🧱 Critical Secret Categories                                              */
/* -------------------------------------------------------------------------- */
const CATEGORIES = {
  AUTH: ["JWT_SECRET", "JWT_REFRESH_SECRET", "ENCRYPTION_KEY"],
  EMAIL: ["SMTP_USER", "SMTP_PASS"],
  PAYMENT: [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
  ],
  CORE: ["DATABASE_URL", "HMAC_SECRET"],
};

const OPTIONAL_SECRETS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "VAULT_TOKEN",
  "OPENAI_API_KEY",
  "REDIS_URL",
];

const REQUIRED_SECRETS = Object.values(CATEGORIES).flat();

/* -------------------------------------------------------------------------- */
/* 🧮 Entropy / Pattern Validation                                            */
/* -------------------------------------------------------------------------- */

/** Estimate entropy bits using unique character count × Shannon entropy approximation */
function estimateEntropy(secret: string): number {
  if (!secret) return 0;
  const freq: Record<string, number> = {};
  for (const char of secret) freq[char] = (freq[char] || 0) + 1;

  const len = secret.length;
  const entropy = Object.values(freq).reduce(
    (acc, f) => acc - (f / len) * Math.log2(f / len),
    0
  );
  return Math.round(entropy * len);
}

/** Detects predictable patterns even when entropy superficially looks okay */
function hasWeakPattern(secret: string): boolean {
  const lower = secret.toLowerCase();
  const weakPatterns = ["1234", "abcd", "password", "secret", "test", "admin", "key"];
  return weakPatterns.some((p) => lower.includes(p));
}

/** Determine if secret meets minimum enterprise security strength */
function isStrongSecret(secret: string, minEntropy = 128): boolean {
  if (!secret || secret.length < 32) return false;
  const entropy = estimateEntropy(secret);
  if (entropy < minEntropy) return false;
  if (hasWeakPattern(secret)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* 🧠 Main Assertion Logic                                                    */
/* -------------------------------------------------------------------------- */

export async function assertCriticalSecrets() {
  logger.info("[SECURITY] 🔐 Verifying critical secrets before startup...");

  const missing: string[] = [];
  const weak: string[] = [];
  const verified: Record<string, string> = {};

  for (const key of REQUIRED_SECRETS) {
    try {
      const val = await secretsManager.get(key);
      if (!val) {
        missing.push(key);
        continue;
      }

      if (!isStrongSecret(val)) {
        weak.push(key);
      } else {
        verified[key] = secretsManager.secretFingerprint(val);
      }
    } catch (err: any) {
      logger.error(`[SECURITY] Failed to retrieve secret "${key}": ${err.message}`);
      missing.push(key);
    }
  }

  // Generate report summary
  const summary = {
    verifiedCount: Object.keys(verified).length,
    missing,
    weak,
    timestamp: new Date().toISOString(),
    backend: (secretsManager as any).backend || "unknown",
  };

  // Record audit event
  await auditService.log({
    actorId: "system",
    actorRole: "system",
    action: "SYSTEM_ALERT",
    details: {
      event: "assertCriticalSecrets",
      result: {
        missing: missing.length,
        weak: weak.length,
        total: REQUIRED_SECRETS.length,
        backend: summary.backend,
      },
    },
  });

  // If issues exist, trigger fail-safe
  if (missing.length > 0 || weak.length > 0) {
    const msg = `[SECURITY] ❌ Critical secret validation failed.
Missing: ${missing.join(", ") || "None"}
Weak: ${weak.join(", ") || "None"}
Backend: ${summary.backend}`;

    logger.error(msg);

    // Notify Super Admins (non-blocking)
    try {
      await createSuperAdminAlert({
        title: "Critical Secret Validation Failed",
        message: msg,
        severity: "critical",
        category: "security",
        metadata: summary,
      });
    } catch {
      logger.warn("[SECURITY] Could not send Super Admin alert.");
    }

    // Graceful shutdown to ensure logs flush
    logger.warn("[SECURITY] Application shutting down for safety...");
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(1);
  }

  logger.info(
    `[SECURITY] ✅ All critical secrets verified successfully (${summary.verifiedCount}/${REQUIRED_SECRETS.length})`
  );
  return summary;
}

/* -------------------------------------------------------------------------- */
/* 🧪 Optional Verification                                                   */
/* -------------------------------------------------------------------------- */
export async function verifyOptionalSecrets() {
  const present: string[] = [];
  for (const key of OPTIONAL_SECRETS) {
    const val = await secretsManager.get(key);
    if (val) present.push(key);
  }
  logger.info(`[SECURITY] Optional secrets detected: ${present.join(", ") || "None"}`);
  return present;
}

/* -------------------------------------------------------------------------- */
/* 🚀 Startup Hook Example                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Use early in app startup:
 *
 * import { assertCriticalSecrets, verifyOptionalSecrets } from "./utils/assertCriticalSecrets";
 * 
 * (async () => {
 *   await assertCriticalSecrets();
 *   await verifyOptionalSecrets();
 *   // Continue boot sequence...
 * })();
 */