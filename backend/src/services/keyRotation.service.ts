/**
 * src/services/keyRotation.service.ts
 * ---------------------------------------------------------------------------
 * 🔑 Key Rotation Service
 *
 * Responsibilities:
 *  - Programmatically trigger or schedule key rotations
 *  - Validate critical secret integrity before/after rotation
 *  - Restore from backup (rollback)
 *  - Provide rotation audit and monitoring capabilities
 *
 * Used by:
 *  - rotateKeys.worker.ts (automated jobs)
 *  - Admin dashboard API (manual trigger)
 *  - Security monitors (validation, audit)
 * ---------------------------------------------------------------------------
 */

import crypto from "crypto";
import { prisma } from "../prismaClient";
import { secretManagerService } from "./secretManager.service";
import { auditService } from "./audit.service";
import { adminNotificationService } from "./adminNotification.service";
import { createSuperAdminAlert } from "./superAdminAlerts.service";
import { logger } from "../logger";

/* -------------------------------------------------------------------------- */
/* 🧮 Entropy & Strength Verification                                         */
/* -------------------------------------------------------------------------- */
function checkSecretEntropy(secret: string): boolean {
  const unique = new Set(secret).size;
  const entropyBits = Math.log2(unique) * secret.length;
  return entropyBits >= 128 && secret.length >= 32;
}

/* -------------------------------------------------------------------------- */
/* 🧱 Service Definition                                                      */
/* -------------------------------------------------------------------------- */
export class KeyRotationService {
  /**
   * 🔁 Trigger a full system key rotation
   */
  static async triggerRotation(triggeredBy: "system" | "super_admin", reason?: string, adminId?: string) {
    const rotationTime = new Date();
    const backupId = `backup_${rotationTime.getTime()}`;
    logger.info(`[KEY ROTATION SERVICE] 🚀 Initiating rotation — triggered by ${triggeredBy}`);

    try {
      // Step 1: Generate new keys
      const newJwtSecret = crypto.randomBytes(64).toString("hex");
      const newEncKey = crypto.randomBytes(32).toString("base64");

      if (!checkSecretEntropy(newJwtSecret) || !checkSecretEntropy(newEncKey)) {
        throw new Error("Generated keys failed entropy test.");
      }

      // Step 2: Fetch current secrets
      const oldJwtSecret = await secretManagerService.getSecret("JWT_SECRET");
      const oldEncKey = await secretManagerService.getSecret("ENCRYPTION_KEY");

      // Step 3: Backup old keys
      await prisma.keyBackup.create({
        data: {
          id: backupId,
          jwtSecret: oldJwtSecret || "",
          encryptionKey: oldEncKey || "",
          createdAt: rotationTime,
          expiresAt: new Date(rotationTime.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days rollback
          checksum: crypto
            .createHash("sha256")
            .update((oldJwtSecret || "") + (oldEncKey || ""))
            .digest("hex"),
        },
      });

      logger.info(`[KEY ROTATION SERVICE] 📦 Backup created: ${backupId}`);

      // Step 4: Stage & activate new secrets
      await secretManagerService.setSecret("NEW_JWT_SECRET", newJwtSecret);
      await secretManagerService.setSecret("NEW_ENCRYPTION_KEY", newEncKey);

      // Verify round-trip retrieval
      const verifyJwt = await secretManagerService.getSecret("NEW_JWT_SECRET");
      const verifyEnc = await secretManagerService.getSecret("NEW_ENCRYPTION_KEY");
      if (!verifyJwt || !verifyEnc) throw new Error("Verification failed: new secrets not retrievable.");

      // Promote to active
      await secretManagerService.setSecret("OLD_JWT_SECRET", oldJwtSecret || "");
      await secretManagerService.setSecret("OLD_ENCRYPTION_KEY", oldEncKey || "");
      await secretManagerService.setSecret("JWT_SECRET", verifyJwt);
      await secretManagerService.setSecret("ENCRYPTION_KEY", verifyEnc);

      process.env.JWT_SECRET = verifyJwt;
      process.env.ENCRYPTION_KEY = verifyEnc;

      // Step 5: Audit & notify
      await auditService.record({
        actorId: adminId || "system",
        actorRole: "super_admin",
        action: "KEY_ROTATION",
        ip: "0.0.0.0",
        details: {
          triggeredBy,
          backupId,
          reason,
          rotationTime: rotationTime.toISOString(),
        },
      });

      await createSuperAdminAlert({
        title: "🔑 Security Notice: Keys Rotated",
        message: `Keys rotated at ${rotationTime.toISOString()}. Backup ID: ${backupId}`,
        category: "security",
        severity: "medium",
        metadata: { triggeredBy, reason, backupId },
      });

      await adminNotificationService.broadcastToSuperAdmins(
        "🔐 Key Rotation Completed",
        `Rotation completed successfully. Backup ID: ${backupId}`
      );

      logger.info(`[KEY ROTATION SERVICE] ✅ Rotation successful (Backup: ${backupId})`);
      return { success: true, backupId, rotatedAt: rotationTime };
    } catch (err: any) {
      logger.error(`[KEY ROTATION SERVICE] ❌ Rotation failed: ${err.message}`);

      await auditService.record({
        actorId: adminId || "system",
        actorRole: "super_admin",
        action: "KEY_ROTATION_FAILED",
        ip: "0.0.0.0",
        details: { error: err.message, stack: err.stack },
      });

      await createSuperAdminAlert({
        title: "Key Rotation Failure",
        message: `Key rotation failed: ${err.message}`,
        category: "security",
        severity: "critical",
        metadata: { error: err.message },
      });

      throw err;
    }
  }

  /**
   * 🔍 Validate current key integrity (entropy, existence)
   */
  static async validateSecrets() {
    const jwtSecret = await secretManagerService.getSecret("JWT_SECRET");
    const encKey = await secretManagerService.getSecret("ENCRYPTION_KEY");

    if (!jwtSecret || !encKey) throw new Error("Critical secrets missing from Secret Manager.");
    if (!checkSecretEntropy(jwtSecret) || !checkSecretEntropy(encKey))
      throw new Error("Critical secrets are weak or corrupted.");

    logger.info("[KEY ROTATION SERVICE] ✅ Secrets validated successfully.");
    return true;
  }

  /**
   * ♻️ Rollback to a previous backup
   */
  static async rollbackToBackup(backupId: string, adminId: string) {
    logger.warn(`[KEY ROTATION SERVICE] ⚠️ Rolling back to backup ${backupId}`);

    const backup = await prisma.keyBackup.findUnique({ where: { id: backupId } });
    if (!backup) throw new Error(`Backup not found: ${backupId}`);

    const checksum = crypto
      .createHash("sha256")
      .update(backup.jwtSecret + backup.encryptionKey)
      .digest("hex");

    if (checksum !== backup.checksum) {
      throw new Error("Backup integrity check failed — potential tampering detected!");
    }

    await secretManagerService.setSecret("JWT_SECRET", backup.jwtSecret);
    await secretManagerService.setSecret("ENCRYPTION_KEY", backup.encryptionKey);

    process.env.JWT_SECRET = backup.jwtSecret;
    process.env.ENCRYPTION_KEY = backup.encryptionKey;

    await auditService.record({
      actorId: adminId,
      actorRole: "super_admin",
      action: "KEY_ROLLBACK",
      ip: "0.0.0.0",
      details: { backupId, restoredAt: new Date().toISOString() },
    });

    await createSuperAdminAlert({
      title: "🔄 Security Rollback Executed",
      message: `System keys restored from backup ${backupId}`,
      category: "security",
      severity: "high",
    });

    logger.info(`[KEY ROTATION SERVICE] ✅ Rollback completed from backup ${backupId}`);
    return { success: true, restoredFrom: backupId };
  }

  /**
   * 🧠 Get recent rotation history
   */
  static async getRotationHistory(limit = 10) {
    return prisma.keyBackup.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

export const keyRotationService = KeyRotationService;