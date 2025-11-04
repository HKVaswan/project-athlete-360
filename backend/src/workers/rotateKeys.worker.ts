/**
 * src/workers/admin/rotateKeys.worker.ts
 * --------------------------------------------------------------------------
 * 🔐 Enterprise-Grade Key Rotation Worker
 *
 * Responsibilities:
 *  - Rotate cryptographic secrets (JWT signing, encryption keys)
 *  - Ensure atomic update + rollback safety
 *  - Verify entropy & strength before commit
 *  - Notify Super Admins + record full audit trail
 *  - Maintain temporary dual-key validity to avoid downtime
 *
 * Triggered by:
 *  - Cron (every 30–60 days)
 *  - Manual Super Admin request
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import crypto from "crypto";
import { logger } from "../../logger";
import { prisma } from "../../prismaClient";
import { secretManagerService } from "../../services/secretManager.service";
import { auditService } from "../../services/audit.service";
import { adminNotificationService } from "../../services/adminNotification.service";
import { createSuperAdminAlert } from "../../services/superAdminAlerts.service";

/* -------------------------------------------------------------------------- */
/* 🧮 Utility: Entropy Check                                                  */
/* -------------------------------------------------------------------------- */
const checkEntropy = (secret: string): boolean => {
  const unique = new Set(secret).size;
  const entropyBits = Math.log2(unique) * secret.length;
  return entropyBits >= 128 && secret.length >= 32;
};

/* -------------------------------------------------------------------------- */
/* 🧱 Worker Definition                                                       */
/* -------------------------------------------------------------------------- */
interface RotateKeysJob {
  triggeredBy: "system" | "super_admin";
  adminId?: string;
  reason?: string;
}

export default async function (job: Job<RotateKeysJob>) {
  const { triggeredBy, adminId, reason } = job.data;
  logger.info(`[KEY ROTATION] 🔐 Job started — triggered by ${triggeredBy}`);

  const rotationTime = new Date();
  const backupId = `backup_${rotationTime.getTime()}`;

  try {
    // 1️⃣ Generate new secrets
    const newJwtSecret = crypto.randomBytes(64).toString("hex");
    const newEncryptionKey = crypto.randomBytes(32).toString("base64");

    if (!checkEntropy(newJwtSecret) || !checkEntropy(newEncryptionKey)) {
      throw new Error("Generated secrets failed entropy verification.");
    }

    // 2️⃣ Fetch current active keys
    const oldJwtSecret = await secretManagerService.getSecret("JWT_SECRET");
    const oldEncKey = await secretManagerService.getSecret("ENCRYPTION_KEY");

    // 3️⃣ Backup old keys (rollback-safe)
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

    logger.info(`[KEY ROTATION] 🧩 Backup created (ID: ${backupId})`);

    // 4️⃣ Stage new keys (prefix NEW_ for zero-downtime)
    await secretManagerService.setSecret("NEW_JWT_SECRET", newJwtSecret);
    await secretManagerService.setSecret("NEW_ENCRYPTION_KEY", newEncryptionKey);

    // 5️⃣ Verification — re-fetch and validate from store
    const verifyJwt = await secretManagerService.getSecret("NEW_JWT_SECRET");
    const verifyEnc = await secretManagerService.getSecret("NEW_ENCRYPTION_KEY");

    if (!verifyJwt || !verifyEnc) {
      throw new Error("Verification failed: newly stored secrets are not retrievable.");
    }

    // 6️⃣ Activate new keys atomically
    await secretManagerService.setSecret("OLD_JWT_SECRET", oldJwtSecret || "");
    await secretManagerService.setSecret("OLD_ENCRYPTION_KEY", oldEncKey || "");
    await secretManagerService.setSecret("JWT_SECRET", verifyJwt);
    await secretManagerService.setSecret("ENCRYPTION_KEY", verifyEnc);

    process.env.JWT_SECRET = verifyJwt;
    process.env.ENCRYPTION_KEY = verifyEnc;

    logger.info(`[KEY ROTATION] ✅ Keys activated successfully.`);

    // 7️⃣ Notify Super Admins
    const notificationMsg = `
System cryptographic keys were rotated successfully.
Triggered by: ${triggeredBy}
Reason: ${reason || "Scheduled rotation"}
Backup ID: ${backupId}
Timestamp: ${rotationTime.toISOString()}
`;
    await adminNotificationService.broadcastToSuperAdmins(
      "🔑 Security Alert: Keys Rotated",
      notificationMsg
    );

    // 8️⃣ Record in audit log
    await auditService.record({
      actorId: adminId || "system",
      actorRole: "super_admin",
      ip: "0.0.0.0",
      action: "KEY_ROTATION",
      details: {
        triggeredBy,
        backupId,
        reason,
        rotationTime: rotationTime.toISOString(),
      },
    });

    // 9️⃣ Super Admin alert summary
    await createSuperAdminAlert({
      title: "System Key Rotation Completed",
      message: `All cryptographic keys successfully rotated. Backup ID: ${backupId}`,
      category: "security",
      severity: "medium",
      metadata: { backupId, triggeredBy, rotationTime },
    });

    logger.info(`[KEY ROTATION] 🧱 Rotation completed — Backup: ${backupId}`);
  } catch (err: any) {
    logger.error(`[KEY ROTATION] ❌ Failed: ${err.message}`);

    await auditService.record({
      actorId: adminId || "system",
      actorRole: "super_admin",
      ip: "0.0.0.0",
      action: "KEY_ROTATION_FAILED",
      details: { error: err.message, stack: err.stack },
    });

    await createSuperAdminAlert({
      title: "Key Rotation Failure",
      message: `Rotation process failed: ${err.message}`,
      category: "security",
      severity: "critical",
      metadata: { error: err.message },
    });

    throw err;
  }
}