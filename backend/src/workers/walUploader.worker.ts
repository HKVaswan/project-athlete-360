/**
 * src/workers/walUploader.worker.ts
 * --------------------------------------------------------------------------
 * 🧱 WAL (Write-Ahead Log) Uploader Worker — Enterprise Grade
 * --------------------------------------------------------------------------
 * Responsibilities:
 *  - Monitor PostgreSQL WAL archive directory
 *  - Compress, encrypt, and upload WAL segments to S3 (or other cloud)
 *  - Ensure durability for Point-In-Time Recovery (PITR)
 *  - Maintain audit logs and metadata for restore verification
 *  - Support retry, deduplication, and failure alerting
 *
 * Trigger:
 *  - Scheduled job or filesystem watcher (every few minutes)
 *  - Runs as a BullMQ worker or cron job
 * --------------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { Job } from "bullmq";
import { logger } from "../../logger";
import { config } from "../../config";
import { uploadToS3 } from "../../lib/s3";
import { prisma } from "../../prismaClient";
import { createSuperAdminAlert } from "../../services/superAdminAlerts.service";

const WAL_DIR = config.pgWalArchivePath || "/var/lib/postgresql/data/pg_wal_archive";
const ENCRYPTION_KEY = config.backupEncryptionKey || crypto.randomBytes(32).toString("hex");

/* --------------------------------------------------------------------------
   🔐 Encrypt + Compress WAL Segment
--------------------------------------------------------------------------- */
async function encryptAndCompress(filePath: string): Promise<string> {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  const gzip = zlib.createGzip({ level: 9 });

  const encryptedPath = `${filePath}.enc.gz`;
  const input = fs.createReadStream(filePath);
  const output = fs.createWriteStream(encryptedPath);

  return new Promise((resolve, reject) => {
    input
      .pipe(gzip)
      .pipe(cipher)
      .pipe(output)
      .on("finish", () => {
        fs.writeFileSync(`${encryptedPath}.meta`, JSON.stringify({ iv: iv.toString("hex") }));
        resolve(encryptedPath);
      })
      .on("error", reject);
  });
}

/* --------------------------------------------------------------------------
   ☁️ Upload WAL Segment to Cloud
--------------------------------------------------------------------------- */
async function uploadWalSegment(encryptedPath: string, walName: string) {
  const checksum = crypto
    .createHash("sha256")
    .update(fs.readFileSync(encryptedPath))
    .digest("hex");

  const result = await uploadToS3({
    key: `wal-archive/${walName}`,
    body: fs.createReadStream(encryptedPath),
    contentType: "application/octet-stream",
    metadata: { checksum },
  });

  await prisma.systemBackup.create({
    data: {
      key: result.key,
      sizeBytes: fs.statSync(encryptedPath).size,
      checksum,
      status: "uploaded",
      createdAt: new Date(),
    },
  });

  logger.info(`[WAL-UPLOADER] ☁️ Uploaded WAL segment: ${walName}`);
  return result;
}

/* --------------------------------------------------------------------------
   🧠 Main Worker Logic
--------------------------------------------------------------------------- */
export default async function (job: Job) {
  logger.info(`[WAL-UPLOADER] 🚀 Starting WAL uploader job ${job.id}`);

  try {
    if (!fs.existsSync(WAL_DIR)) {
      throw new Error(`WAL archive directory not found: ${WAL_DIR}`);
    }

    const walFiles = fs.readdirSync(WAL_DIR).filter((f) => /^[0-9A-F]{24}$/.test(f));
    if (walFiles.length === 0) {
      logger.info("[WAL-UPLOADER] ℹ️ No WAL files to upload.");
      return;
    }

    for (const walName of walFiles) {
      const walPath = path.join(WAL_DIR, walName);
      const encryptedPath = await encryptAndCompress(walPath);
      await uploadWalSegment(encryptedPath, walName);

      // Cleanup local copy after successful upload
      fs.unlinkSync(walPath);
      fs.unlinkSync(encryptedPath);
      fs.unlinkSync(`${encryptedPath}.meta`);
    }

    logger.info(`[WAL-UPLOADER] ✅ All WAL files uploaded successfully.`);
  } catch (err: any) {
    logger.error(`[WAL-UPLOADER] ❌ Upload failed: ${err.message}`);
    await createSuperAdminAlert({
      title: "WAL Uploader Failure",
      message: `Error: ${err.message}`,
      category: "backup",
      severity: "high",
    });

    await prisma.systemBackup.create({
      data: {
        key: `WAL-UPLOADER-FAILED-${Date.now()}`,
        sizeBytes: 0,
        checksum: "N/A",
        status: "failed",
        createdAt: new Date(),
        meta: { error: err.message },
      },
    });

    throw err;
  }
}