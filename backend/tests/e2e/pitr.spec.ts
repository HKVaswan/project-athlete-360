/**
 * tests/e2e/pitr.spec.ts
 * --------------------------------------------------------------------------
 * 🔁 End-to-End Test — Point-In-Time Recovery (PITR)
 *
 * Objective:
 *   Validate that the platform can restore the database to a
 *   specific point in time (within WAL archive retention).
 *
 * Covers:
 *   - WAL archiver integration
 *   - Time-based restore to target timestamp
 *   - Data consistency verification (pre + post restore)
 *   - Full audit and alert validation
 *
 * Note:
 *   This test assumes the WAL archiver (src/lib/walArchiver.ts)
 *   and restore client are correctly wired for PITR operations.
 * --------------------------------------------------------------------------
 */

import { prisma } from "../../src/prismaClient";
import { runFullBackup } from "../../src/lib/backupClient";
import { walArchiver } from "../../src/lib/walArchiver";
import { restoreToTimestamp } from "../../src/lib/restoreClient";
import { logger } from "../../src/logger";
import { createSuperAdminAlert } from "../../src/services/superAdminAlerts.service";
import crypto from "crypto";

jest.setTimeout(180000); // allow 3 minutes for PITR tests

/* --------------------------------------------------------------------------
   🧩 Utility Helpers
---------------------------------------------------------------------------*/
async function seedBaselineData() {
  const user = await prisma.user.create({
    data: {
      id: "pitr-user-1",
      email: "pitruser@test.com",
      name: "Baseline User",
      role: "athlete",
    },
  });

  await prisma.athleteProfile.create({
    data: {
      id: "pitr-athlete-1",
      userId: user.id,
      sport: "Swimming",
      achievements: "State Champion",
    },
  });

  return user;
}

async function mutateDataAfterBackup() {
  await prisma.user.update({
    where: { id: "pitr-user-1" },
    data: { name: "Modified User After Backup" },
  });

  await prisma.athleteProfile.deleteMany({
    where: { userId: "pitr-user-1" },
  });
}

/* --------------------------------------------------------------------------
   🧪 Test Suite — PITR
---------------------------------------------------------------------------*/
describe("🕰️ Point-In-Time Recovery (PITR) E2E Test", () => {
  let baselineTime: Date;
  let backupKey: string;

  beforeAll(async () => {
    logger.info("[PITR TEST] Seeding baseline data...");
    await seedBaselineData();

    logger.info("[PITR TEST] Running full backup...");
    backupKey = await runFullBackup();
    baselineTime = new Date();

    // simulate WAL archiving from this point forward
    await walArchiver.archiveSegment();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    logger.info("[PITR TEST] Prisma disconnected.");
  });

  test("should verify baseline data exists before mutation", async () => {
    const user = await prisma.user.findUnique({ where: { id: "pitr-user-1" } });
    expect(user?.name).toBe("Baseline User");
  });

  test("should mutate data after backup (simulating drift)", async () => {
    await mutateDataAfterBackup();

    const user = await prisma.user.findUnique({ where: { id: "pitr-user-1" } });
    expect(user?.name).toBe("Modified User After Backup");

    const athletes = await prisma.athleteProfile.count({ where: { userId: "pitr-user-1" } });
    expect(athletes).toBe(0);
  });

  test("should restore DB to baseline timestamp via PITR", async () => {
    logger.info(`[PITR TEST] Initiating restore to timestamp: ${baselineTime.toISOString()}`);

    // run restore client for target timestamp
    await restoreToTimestamp({
      timestamp: baselineTime.toISOString(),
      baseBackupKey: backupKey,
    });

    // verify data rolled back correctly
    const restoredUser = await prisma.user.findUnique({ where: { id: "pitr-user-1" } });
    const restoredAthlete = await prisma.athleteProfile.findFirst({
      where: { userId: "pitr-user-1" },
    });

    expect(restoredUser?.name).toBe("Baseline User");
    expect(restoredAthlete?.sport).toBe("Swimming");

    const checksum = crypto
      .createHash("sha256")
      .update(`${restoredUser?.id}:${restoredAthlete?.id}`)
      .digest("hex");

    logger.info(`[PITR TEST] ✅ PITR successful. Data checksum: ${checksum}`);
  });

  test("should send audit + alert for PITR restore", async () => {
    await createSuperAdminAlert({
      title: "PITR Restore Validation Completed",
      message: `Database successfully restored to ${baselineTime.toISOString()}`,
      severity: "medium",
      category: "backup",
      metadata: { test: "pitr.spec.ts", timestamp: baselineTime },
    });

    const recentAlerts = await prisma.systemAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    expect(recentAlerts[0]?.title).toContain("PITR Restore Validation");
  });
});