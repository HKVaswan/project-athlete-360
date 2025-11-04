/**
 * src/utils/assertCriticalSecrets.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise-Grade Secret Assertion Utility
 *
 * Purpose:
 *   - Centralized enforcement that all critical secrets exist before boot.
 *   - Ensures secrets have sufficient entropy (strength).
 *   - Prevents the app from running in a weak or misconfigured environment.
 *   - Produces readable diagnostics + sends Super Admin alert if necessary.
 *
 * Features:
 *   - Works with src/config/secretsManager.ts (Vault / AWS / Env)
 *   - Entropy, length, and format checks
 *   - Critical categories: Auth, Encryption, Payment, Email, and API keys
 *   - Hard fail (exit process) if critical issues detected
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import secretsManager from "../config/secretsManager";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";

/* -------------------------------------------------------------------------- */
/* 🧱 Secret Definitions (Critical + Optional)                                */
/* -------------------------------------------------------------------------- */

const REQUIRED_SECRETS = [
  // 🔐 Authentication / Session
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "ENCRYPTION_KEY",

  // 📧 Email delivery
  "SMTP_PASS",
  "SMTP_USER",

  // 💰 Payment gateways
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",

  // 🗄️ Database & Core services
  "DATABASE_URL",

  // 🧩 Internal services / HMAC
  "HMAC_SECRET",
];

const OPTIONAL_SECRETS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "VAULT_TOKEN",
  "OPENAI_API_KEY",
  "REDIS_URL",
];

/* -------------------------------------------------------------------------- */
/* 🧮 Entropy / Strength Checker                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rough entropy estimation: checks base64 or hex randomness.
 * We only use this to flag suspiciously weak secrets.
 */
function estimateEntropy(secret: string): number {
  if (!secret) return 0;
  const uniqueChars = new Set(secret).size;
  const length = secret.length;
  const entropyBits = Math.log2(uniqueChars) * length;
  return Math.round(entropyBits);
}

/**
 * Validate that secret has decent entropy (≥128 bits) and length (≥32 chars)
 */
function isStrongSecret(secret: string, minEntropy = 128): boolean {
  if (secret.length < 32) return false;
  const entropy = estimateEntropy(secret);
  return entropy >= minEntropy;
}

/* -------------------------------------------------------------------------- */
/* 🧠 assertCriticalSecrets() Implementation                                 */
/* -------------------------------------------------------------------------- */

export async function assertCriticalSecrets() {
  logger.info("[SECURITY] 🧩 Running critical secret verification...");

  const missing: string[] = [];
  const weak: string[] = [];
  const verified: Record<string, string> = {};

  for (const key of REQUIRED_SECRETS) {
    const val = await secretsManager.get(key);
    if (!val) {
      missing.push(key);
      continue;
    }
    if (!isStrongSecret(val)) {
      weak.push(key);
    } else {
      // fingerprint for audit (not the secret itself)
      verified[key] = secretsManager.secretFingerprint(val);
    }
  }

  if (missing.length > 0 || weak.length > 0) {
    const msg = `[SECURITY] ❌ Secret validation failed:
Missing: ${missing.join(", ") || "None"}
Weak: ${weak.join(", ") || "None"}`;

    logger.error(msg);

    // Send alert to Super Admin (non-blocking)
    try {
      await createSuperAdminAlert({
        title: "Critical Secret Validation Failed",
        message: msg,
        severity: "critical",
        category: "security",
        metadata: { missing, weak },
      });
    } catch {
      logger.warn("[SECURITY] Failed to send super admin alert for secret failure");
    }

    // Fail fast to prevent unsafe runtime
    console.error("\n\n🚨 CRITICAL: Missing or weak secrets detected. Stopping application.\n");
    process.exit(1);
  }

  logger.info(`[SECURITY] ✅ All critical secrets verified. (${Object.keys(verified).length} OK)`);
  return verified;
}

/* -------------------------------------------------------------------------- */
/* 🧪 Optional helper for tests / diagnostics                                 */
/* -------------------------------------------------------------------------- */

export async function verifyOptionalSecrets() {
  const present: string[] = [];
  for (const key of OPTIONAL_SECRETS) {
    const val = await secretsManager.get(key);
    if (val) present.push(key);
  }
  logger.info(`[SECURITY] Optional secrets present: ${present.join(", ") || "None"}`);
  return present;
}

/* -------------------------------------------------------------------------- */
/* 🚀 Bootstrap Integration                                                  */
/* -------------------------------------------------------------------------- */
/**
 * Call this at application startup:
 * 
 * import { assertCriticalSecrets } from "./utils/assertCriticalSecrets";
 * 
 * (async () => {
 *   await assertCriticalSecrets();
 *   await verifyOptionalSecrets();
 *   // Continue boot sequence...
 * })();
 */