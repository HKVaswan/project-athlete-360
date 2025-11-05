/**
 * backend/tests/integration/backup_restore.integration.spec.ts
 * ---------------------------------------------------------------------
 * 🔬 Integration Test — Full Backup → Restore → Verification
 *
 * Objective:
 *   End-to-end test that ensures the system can:
 *     - Run real backup jobs (via backup worker/client)
 *     - Upload/download backup from storage (S3 or local)
 *     - Simulate database wipe (disaster)
 *     - Fully restore data and verify checksums
 *     - Validate audit entries and metadata consistency
 *
 * Designed to mirror production backup–restore pipelines safely in test mode.
 * ---------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../../../src/prismaClient";
import { runFullBackup } from "../../../src/lib/backupClient";
import { restoreFromCloudBackup } from "../../../src/lib/restoreClient";
import { uploadToS3, downloadFromS3 } from "../../../src/utils/storage";
import { logger } from "../../../src/logger";

jest.setTimeout(120000); // Allow 2 minutes for full cycle

/* ---------------------------------------------------------------------
   🧱 Setup Utilities
------------------------------------------------------------------------*/
const TMP_DIR = path.join(__dirname, "../../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

async function seedTestData() {
  await prisma.user.create({
    data: {
      id: "test-user-1",
      email: "athlete@test.com",
      name: "Test Athlete",
      role: "athlete",
    },
  });

  await prisma.athleteProfile.create({
    data: {
      id: "athlete-1",
      userId: "test-user-1",
      sport: "Track",
      achievements: "National level sprinter",
    },
  });
}

async function clearTestData() {
  await prisma.athleteProfile.deleteMany({});
  await prisma.user.deleteMany({});
}

/* ---------------------------------------------------------------------
   🧮 Helper: Compute Integrity Checksum
------------------------------------------------------------------------*/
function computeChecksum(payload: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* ---------------------------------------------------------------------
   🧪 Test Suite
------------------------------------------------------------------------*/
describe("🧩 Backup → Restore → Verification", () => {
  let backupFileKey: string | null = null;
  let preBackupChecksum = "";

  beforeAll(async () => {
    logger.info("[TEST] 🧩 Seeding initial data...");
    await clearTestData();
    await seedTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    logger.info("[TEST] 🧹 Prisma disconnected.");
  });

  /* -----------------------------------------------------------------
     1️⃣ Perform Backup
  ----------------------------------------------------------------- */
  test("should create a full backup successfully", async () => {
    const user = await prisma.user.findFirst({ where: { id: "test-user-1" } });
    const athlete = await prisma.athleteProfile.findFirst({ where: { userId: "test-user-1" } });

    preBackupChecksum = computeChecksum({ user, athlete });

    const backupPath = await runFullBackup();
    expect(fs.existsSync(backupPath)).toBe(true);

    // Upload to mock S3 (can be swapped with local filesystem)
    const s3Resp = await uploadToS3({
      filePath: backupPath,
      bucket: "test-backups",
      key: path.basename(backupPath),
    });

    backupFileKey = s3Resp?.key || path.basename(backupPath);

    const dbEntry = await prisma.backup.findFirst({
      where: { fileName: path.basename(backupPath) },
    });

    expect(dbEntry?.status).toBe("SUCCESS");
    expect(backupFileKey).toBeTruthy();

    logger.info(`[TEST] ✅ Backup created and uploaded: ${backupFileKey}`);
  });

  /* -----------------------------------------------------------------
     2️⃣ Simulate Data Loss (Disaster)
  ----------------------------------------------------------------- */
  test("should simulate catastrophic data loss", async () => {
    await clearTestData();

    const userCount = await prisma.user.count();
    const athleteCount = await prisma.athleteProfile.count();

    expect(userCount).toBe(0);
    expect(athleteCount).toBe(0);

    logger.info("[TEST] 💥 Simulated data loss completed.");
  });

  /* -----------------------------------------------------------------
     3️⃣ Restore from Backup
  ----------------------------------------------------------------- */
  test("should restore database successfully from cloud/local backup", async () => {
    expect(backupFileKey).toBeTruthy();

    const restoredFile = await downloadFromS3({
      bucket: "test-backups",
      key: backupFileKey!,
    });

    expect(fs.existsSync(restoredFile)).toBe(true);

    await restoreFromCloudBackup(backupFileKey!);

    const userCount = await prisma.user.count();
    const athleteCount = await prisma.athleteProfile.count();

    expect(userCount).toBeGreaterThan(0);
    expect(athleteCount).toBeGreaterThan(0);

    logger.info("[TEST] ✅ Restore operation completed successfully.");
  });

  /* -----------------------------------------------------------------
     4️⃣ Verify Data Integrity
  ----------------------------------------------------------------- */
  test("should confirm integrity and checksum match after restore", async () => {
    const user = await prisma.user.findUnique({ where: { id: "test-user-1" } });
    const athlete = await prisma.athleteProfile.findFirst({ where: { userId: "test-user-1" } });

    const postRestoreChecksum = computeChecksum({ user, athlete });

    expect(user?.email).toBe("athlete@test.com");
    expect(athlete?.sport).toBe("Track");
    expect(postRestoreChecksum).toBe(preBackupChecksum);

    logger.info(`[TEST] 🔐 Integrity verified. Checksum: ${postRestoreChecksum}`);
  });

  /* -----------------------------------------------------------------
     5️⃣ Metadata Verification
  ----------------------------------------------------------------- */
  test("should verify backup metadata and audit logs exist", async () => {
    const backupLogs = await prisma.backup.findMany({
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    expect(backupLogs.length).toBeGreaterThan(0);
    expect(backupLogs[0].status).toBe("SUCCESS");
    expect(backupLogs[0].fileName).toContain(".enc");

    logger.info("[TEST] 📊 Backup metadata and audit logs verified.");
  });
});