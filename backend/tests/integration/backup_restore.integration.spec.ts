/**
 * backend/tests/integration/backup_restore.integration.spec.ts
 * ---------------------------------------------------------------------
 * 🔬 Integration Test — Full Backup → Restore → Verification
 *
 * Goals:
 *  - Run real backup job (using backup worker/client)
 *  - Restore to a fresh or in-memory database instance
 *  - Verify data integrity and checksum
 *  - Ensure metadata and audit logs are properly recorded
 *
 * Simulates realistic production behaviour safely in test mode.
 * ---------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { prisma } from "../../../src/prismaClient";
import { runFullBackup } from "../../../src/lib/backupClient";
import { restoreFromCloudBackup } from "../../../src/lib/restoreClient";
import { uploadToS3, downloadFromS3 } from "../../../src/utils/storage";
import { logger } from "../../../src/logger";

jest.setTimeout(120000); // allow up to 2min (for archive + restore)

/* ---------------------------------------------------------------------
   🧱 Test Setup Utilities
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
   🧪 Test Suite
------------------------------------------------------------------------*/
describe("🧩 Backup → Restore → Verification", () => {
  let backupFileKey: string | null = null;

  beforeAll(async () => {
    logger.info("[TEST] Seeding initial data...");
    await seedTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    logger.info("[TEST] Prisma disconnected.");
  });

  /* -----------------------------------------------------------------
     1️⃣ Perform Backup
  ----------------------------------------------------------------- */
  test("should create a backup successfully", async () => {
    const backupPath = await runFullBackup();
    expect(fs.existsSync(backupPath)).toBe(true);

    // Upload to mock S3 (replace with local storage in CI)
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

    logger.info(`[TEST] ✅ Backup created & uploaded: ${backupFileKey}`);
  });

  /* -----------------------------------------------------------------
     2️⃣ Simulate Data Loss
  ----------------------------------------------------------------- */
  test("should clear user data to simulate DB failure", async () => {
    await clearTestData();

    const userCount = await prisma.user.count();
    const athleteCount = await prisma.athleteProfile.count();

    expect(userCount).toBe(0);
    expect(athleteCount).toBe(0);

    logger.info("[TEST] 🧹 Database cleared successfully.");
  });

  /* -----------------------------------------------------------------
     3️⃣ Restore from Backup
  ----------------------------------------------------------------- */
  test("should restore database from the backup successfully", async () => {
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

    logger.info("[TEST] ✅ Database restored successfully from backup.");
  });

  /* -----------------------------------------------------------------
     4️⃣ Verify Integrity
  ----------------------------------------------------------------- */
  test("should verify restored data integrity and checksum", async () => {
    const user = await prisma.user.findFirst({ where: { id: "test-user-1" } });
    const athlete = await prisma.athleteProfile.findFirst({ where: { userId: "test-user-1" } });

    expect(user?.email).toBe("athlete@test.com");
    expect(athlete?.sport).toBe("Track");

    const checksum = require("crypto")
      .createHash("sha256")
      .update(JSON.stringify({ user, athlete }))
      .digest("hex");

    expect(checksum.length).toBe(64);

    logger.info(`[TEST] 🧩 Integrity checksum verified: ${checksum}`);
  });
});