/**
 * backend/tests/e2e/backup_restore.spec.ts
 * --------------------------------------------------------------------------
 * 🧩 E2E: Database Backup → Restore → Verification
 *
 * PURPOSE:
 *  - Run full backup & restore cycle against ephemeral (or staging) DB
 *  - Validate DB integrity, checksum, and record count
 *  - Confirm no schema corruption or missing data
 *
 * FEATURES:
 *  - Uses temporary Postgres test DB (Docker or ephemeral)
 *  - Runs createDatabaseBackup(), uploadBackupToCloud(), restoreDatabaseFromFile()
 *  - Verifies sample data before & after restore
 *  - Automatically cleans up temp backups
 *
 * REQUIREMENTS:
 *  - Test DB connection string (POSTGRES_TEST_URL)
 *  - AWS credentials for S3 mock or actual bucket (optional)
 * --------------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { prisma } from "../../../src/prismaClient";
import { createDatabaseBackup, uploadBackupToCloud } from "../../../src/lib/backupClient";
import { restoreDatabaseFromFile } from "../../../src/lib/restoreClient";
import { logger } from "../../../src/logger";

const TEST_BACKUP_DIR = path.join(process.cwd(), "backups", "test");
const TEST_DB_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL || "";
const SAMPLE_TABLE = "User"; // Change to small reliable table

describe("🧩 Backup & Restore E2E Test", () => {
  beforeAll(async () => {
    if (!TEST_DB_URL) throw new Error("POSTGRES_TEST_URL not set!");
    if (!fs.existsSync(TEST_BACKUP_DIR)) fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });

    // ✅ Seed minimal data to verify restore correctness
    await prisma.user.create({
      data: {
        username: "backup_tester",
        email: "backup@test.com",
        passwordHash: "hashed",
        role: "ATHLETE",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(TEST_BACKUP_DIR)) fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  });

  it("should perform full database backup → restore successfully", async () => {
    logger.info("🚀 Starting backup-restore E2E...");

    // Step 1️⃣: Verify initial record count
    const initialCount = await prisma.user.count();
    expect(initialCount).toBeGreaterThan(0);

    // Step 2️⃣: Run database backup
    const backupPath = await createDatabaseBackup();
    expect(fs.existsSync(backupPath)).toBeTruthy();

    // Step 3️⃣: Simulate upload (local or mock S3)
    const cloudResult = await uploadBackupToCloud(backupPath);
    expect(cloudResult.key).toContain("backups/");
    expect(cloudResult.checksum).toHaveLength(64);

    // Step 4️⃣: Corrupt local DB (simulate data loss)
    await prisma.user.deleteMany();
    const afterDelete = await prisma.user.count();
    expect(afterDelete).toBe(0);

    // Step 5️⃣: Restore from local backup
    await restoreDatabaseFromFile(backupPath, { dryRun: false });

    // Step 6️⃣: Validate restored data
    const restoredCount = await prisma.user.count();
    expect(restoredCount).toBe(initialCount);

    logger.info("✅ E2E Backup & Restore cycle verified successfully!");
  });

  it("should handle invalid backup gracefully", async () => {
    const invalidPath = path.join(TEST_BACKUP_DIR, "fake_backup.sql");
    fs.writeFileSync(invalidPath, "corrupted data");

    await expect(restoreDatabaseFromFile(invalidPath)).rejects.toThrow();
  });

  it("should measure backup performance and log RTO", async () => {
    const start = Date.now();
    const backupPath = await createDatabaseBackup();
    const duration = (Date.now() - start) / 1000;

    logger.info(`📊 Backup completed in ${duration}s`);
    expect(duration).toBeLessThan(120); // 2 min max for enterprise DBs
    expect(fs.existsSync(backupPath)).toBeTruthy();
  });
});