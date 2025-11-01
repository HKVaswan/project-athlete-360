/**
 * src/workers/admin/rotateKeys.worker.ts
 * --------------------------------------------------------------------------
 * 🔐 Admin Key Rotation Worker
 *
 * Responsibilities:
 *  - Rotate cryptographic keys (JWT signing, encryption keys, API secrets)
 *  - Securely update entries in the Secret Manager
 *  - Maintain rollback safety (previous key backup)
 *  - Notify Super Admins upon rotation
 *  - Record all actions in Audit Logs
 *
 * Triggers:
 *  - Scheduled rotation job (e.g. every 30 days)
 *  - Manual trigger by Super Admin
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import crypto from "crypto";
import { logger } from "../../logger";
import { secretManagerService } from "../../services/secretManager.service";
import { auditService } from "../../services/audit.service";
import { adminNotificationService } from "../../services/adminNotification.service";
import { prisma } from "../../prismaClient";

interface RotateKeysJob {
  triggeredBy: "system" | "super_admin";
  adminId?: string;
  reason?: string;
}

export default async function (job: Job<RotateKeysJob>) {
  const { triggeredBy, adminId, reason } = job.data;

  logger.info(`[KEY ROTATION] 🔐 Job started — triggered by: ${triggeredBy}`);

  try {
    // ---------------------------------------------------------------------
    // 1️⃣ Generate new cryptographic secrets
    // ---------------------------------------------------------------------
    const newJwtSecret = crypto.randomBytes(48).toString("hex");
    const newEncryptionKey = crypto.randomBytes(32).toString("base64");

    // ---------------------------------------------------------------------
    // 2️⃣ Retrieve current keys from Secret Manager
    // ---------------------------------------------------------------------
    const oldJwtSecret = await secretManagerService.getSecret("JWT_SECRET");
    const oldEncryptionKey = await secretManagerService.getSecret("ENCRYPTION_KEY");

    // ---------------------------------------------------------------------
    // 3️⃣ Backup old keys (for rollback window)
    // ---------------------------------------------------------------------
    const backupId = `backup_${Date.now()}`;
    await prisma.keyBackup.create({
      data: {
        id: backupId,
        jwtSecret: oldJwtSecret || "",
        encryptionKey: oldEncryptionKey || "",
        createdAt: new Date(),
      },
    });

    logger.info(`[KEY ROTATION] 🧩 Backup created: ${backupId}`);

    // ---------------------------------------------------------------------
    // 4️⃣ Update new secrets in secure store
    // ---------------------------------------------------------------------
    await secretManagerService.setSecret("JWT_SECRET", newJwtSecret);
    await secretManagerService.setSecret("ENCRYPTION_KEY", newEncryptionKey);

    // Optional: Invalidate caches / notify services if required
    process.env.JWT_SECRET = newJwtSecret;

    // ---------------------------------------------------------------------
    // 5️⃣ Notify Super Admins
    // ---------------------------------------------------------------------
    const title = "🔑 Security Notice: System Keys Rotated";
    const body = `System keys were successfully rotated at ${new Date().toISOString()}.
Reason: ${reason || "Scheduled rotation"}.
Backup ID: ${backupId}`;

    await adminNotificationService.broadcastToSuperAdmins(title, body);

    // ---------------------------------------------------------------------
    // 6️⃣ Record Audit Log
    // ---------------------------------------------------------------------
    await auditService.record({
      actorId: adminId || "system",
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      ip: "0.0.0.0",
      details: {
        event: "key_rotation",
        reason: reason || "Automated security rotation",
        backupId,
      },
    });

    logger.info(`[KEY ROTATION] ✅ Completed successfully (Backup ID: ${backupId})`);
  } catch (err: any) {
    logger.error(`[KEY ROTATION] ❌ Failed: ${err.message}`);

    // Record failure event
    await auditService.record({
      actorId: adminId || "system",
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      ip: "0.0.0.0",
      details: { event: "key_rotation_failed", error: err.message },
    });

    throw err;
  }
}
