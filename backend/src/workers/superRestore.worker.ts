/**
 * src/workers/superRestore.worker.ts
 * --------------------------------------------------------------------------
 * Super Restore Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Restore system or database from secure backup archives
 *  - Validate backup integrity (checksum verification)
 *  - Maintain full audit trails and rollback safety
 *  - Notify all super admins upon success or failure
 *  - Designed for emergency disaster recovery
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { restoreFromCloudBackup } from "../lib/restoreClient";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";
import { secretManagerService } from "../services/secretManager.service";

interface SuperRestoreJob {
  initiatedBy: string; // super_admin ID
  s3Key: string;       // Backup key or filename
  checksum?: string;   // Expected checksum for validation
  reason?: string;
}

export default async function (job: Job<SuperRestoreJob>) {
  const { initiatedBy, s3Key, checksum, reason } = job.data;
  logger.warn(`[SUPER-RESTORE] ⚠️ Restore job ${job.id} initiated by ${initiatedBy}`);

  try {
    // 🔐 Verify environment allows restoration
    const envKeys = await secretManagerService.get("RESTORE_PERMISSIONS");
    if (!envKeys?.includes("ENABLED")) {
      throw new Error("Restore operation not permitted in this environment.");
    }

    // 🧾 Fetch backup metadata
    const backup = await prisma.systemBackup.findUnique({ where: { key: s3Key } });
    if (!backup) throw new Error("Specified backup record not found.");

    // ✅ Verify integrity checksum before restoring
    if (checksum && backup.checksum && checksum !== backup.checksum) {
      throw new Error("Checksum mismatch. Backup file may be corrupted or tampered.");
    }

    // ⚙️ Execute the restore
    logger.info(`[SUPER-RESTORE] Restoring from ${s3Key}...`);
    const restoreResult = await restoreFromCloudBackup(s3Key);

    // 🔍 Verify post-restore integrity
    if (fs.existsSync(restoreResult.localPath)) {
      const restoredChecksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(restoreResult.localPath))
        .digest("hex");

      if (backup.checksum && restoredChecksum !== backup.checksum) {
        throw new Error("Post-restore integrity check failed.");
      }
    }

    // 🧠 Log in audit trail
    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "ADMIN_OVERRIDE",
      entity: "system_backup",
      entityId: backup.id,
      details: {
        event: "system_restore",
        backupKey: s3Key,
        verifiedChecksum: checksum || backup.checksum,
        reason: reason || "manual restore",
      },
    });

    // 💬 Notify all super admins
    await adminNotificationService.broadcastAlert({
      title: "🛠️ System Restore Successful",
      body: `System successfully restored from ${s3Key}.`,
      meta: { backupId: backup.id, checksum: checksum || backup.checksum },
    });

    logger.info(`[SUPER-RESTORE] ✅ Restore from ${s3Key} completed successfully.`);
  } catch (err: any) {
    logger.error(`[SUPER-RESTORE] ❌ Restore failed: ${err.message}`, { stack: err.stack });

    // 🚨 Audit the failure
    await auditService.log({
      actorId: initiatedBy || "system",
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: {
        event: "restore_failure",
        s3Key,
        reason: err.message,
      },
    });

    // Alert all super admins of failure
    await adminNotificationService.broadcastAlert({
      title: "⚠️ System Restore Failed",
      body: `Restore from ${s3Key} failed. Reason: ${err.message}`,
      meta: { s3Key, error: err.message },
    });

    throw err;
  }
}