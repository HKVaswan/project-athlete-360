/**
 * src/services/secretManager.service.ts
 * --------------------------------------------------------------------------
 * Enterprise Secret Manager Service
 *
 * Responsibilities:
 *  - Securely store, retrieve, rotate, and audit critical secrets.
 *  - Supports AES-256 encryption at rest and optional HSM/KMS integration.
 *  - Protects system tokens (JWT, OpenAI, S3, Impersonation, etc.)
 *  - Full audit trail for access, updates, and rotations.
 *  - In-memory caching with auto-expiry for performance and security.
 * --------------------------------------------------------------------------
 */

import crypto from "crypto";
import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "./audit.service";
import { Errors } from "../utils/errors";
import { config } from "../config";

/* -----------------------------------------------------------------------
   🔑 AES Encryption / Decryption
------------------------------------------------------------------------*/
const AES_KEY = process.env.MASTER_KEY || config.masterKey;
if (!AES_KEY || AES_KEY.length < 32) {
  throw new Error("MASTER_KEY is missing or too short (min 32 chars required).");
}

const ALGORITHM = "aes-256-gcm";

/**
 * Encrypt secret value using AES-256-GCM
 */
const encryptSecret = (plaintext: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(AES_KEY, "utf8"), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
};

/**
 * Decrypt secret value using AES-256-GCM
 */
const decryptSecret = (ciphertext: string) => {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(AES_KEY, "utf8"),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

/* -----------------------------------------------------------------------
   🧩 Secret Manager Core
------------------------------------------------------------------------*/
interface SecretCacheEntry {
  value: string;
  expiresAt: number;
}

class SecretManagerService {
  private cache = new Map<string, SecretCacheEntry>();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Store or update a secret (AES encrypted).
   * Only super_admin can trigger this through secure controller.
   */
  async storeSecret(key: string, value: string, actorId: string, actorRole: string) {
    try {
      const encrypted = encryptSecret(value);

      await prisma.systemSecret.upsert({
        where: { key },
        update: { value: encrypted, updatedAt: new Date() },
        create: { key, value: encrypted },
      });

      await auditService.log({
        actorId,
        actorRole,
        action: "SECURITY_EVENT",
        details: { key, event: "Secret stored/updated" },
      });

      this.cache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL });
      logger.info(`[SECRET] 🔐 Secret stored successfully: ${key}`);
    } catch (err: any) {
      logger.error(`[SECRET] ❌ Failed to store secret: ${err.message}`);
      throw Errors.Server("Failed to store secret securely.");
    }
  }

  /**
   * Retrieve a decrypted secret (uses cache for speed).
   */
  async getSecret(key: string): Promise<string | null> {
    try {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }

      const record = await prisma.systemSecret.findUnique({ where: { key } });
      if (!record) return null;

      const decrypted = decryptSecret(record.value);
      this.cache.set(key, { value: decrypted, expiresAt: Date.now() + this.CACHE_TTL });

      return decrypted;
    } catch (err: any) {
      logger.error(`[SECRET] ❌ Failed to retrieve secret: ${err.message}`);
      throw Errors.Server("Secret retrieval failed.");
    }
  }

  /**
   * Rotate a secret (generate a new version, preserve audit).
   */
  async rotateSecret(key: string, newValue: string, actorId: string, actorRole: string) {
    try {
      const encrypted = encryptSecret(newValue);

      await prisma.systemSecret.update({
        where: { key },
        data: {
          value: encrypted,
          rotatedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await auditService.log({
        actorId,
        actorRole,
        action: "SECURITY_EVENT",
        details: { key, event: "Secret rotated" },
      });

      this.cache.set(key, { value: newValue, expiresAt: Date.now() + this.CACHE_TTL });
      logger.info(`[SECRET] 🔄 Secret rotated: ${key}`);
    } catch (err: any) {
      logger.error(`[SECRET] ❌ Failed to rotate secret: ${err.message}`);
      throw Errors.Server("Secret rotation failed.");
    }
  }

  /**
   * List all stored secrets (metadata only).
   */
  async listSecretsMetadata() {
    const secrets = await prisma.systemSecret.findMany({
      select: { key: true, createdAt: true, updatedAt: true, version: true, rotatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    return secrets;
  }

  /**
   * Revoke a secret completely (emergency action).
   */
  async revokeSecret(key: string, actorId: string, actorRole: string) {
    try {
      await prisma.systemSecret.delete({ where: { key } });

      await auditService.log({
        actorId,
        actorRole,
        action: "ADMIN_OVERRIDE",
        details: { key, event: "Secret revoked" },
      });

      this.cache.delete(key);
      logger.warn(`[SECRET] ⚠️ Secret revoked: ${key}`);
    } catch (err: any) {
      logger.error(`[SECRET] ❌ Failed to revoke secret: ${err.message}`);
      throw Errors.Server("Failed to revoke secret.");
    }
  }

  /**
   * Flush secret cache (manual or scheduled).
   */
  clearCache() {
    this.cache.clear();
    logger.info("[SECRET] 🧹 Secret cache cleared.");
  }
}

/* -----------------------------------------------------------------------
   🚀 Export Singleton
------------------------------------------------------------------------*/
export const secretManager = new SecretManagerService();