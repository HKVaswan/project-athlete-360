/**
 * tests/integration/backup_encryption.spec.ts
 * -------------------------------------------------------------------------
 * 🔐 Integration Test — Backup Encryption & Decryption Workflow
 *
 * Goals:
 *  - Verify AES-256 encryption/decryption correctness
 *  - Ensure backup files remain intact after decrypt
 *  - Validate checksum consistency before/after encryption
 *  - Detect tampered or corrupted backups
 *  - Confirm .meta file (salt, IV) handling correctness
 *
 * This test isolates the encryption/decryption pipeline to ensure
 * cryptographic reliability before full DR/backup_restore flows.
 * -------------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../../src/logger";
import { prisma } from "../../src/prismaClient";
import { runFullBackup } from "../../src/lib/backupClient";
import { decryptFile } from "../../src/lib/restoreClient";

jest.setTimeout(60000); // 60s max runtime

/* -----------------------------------------------------------------------
   🧱 Utilities
------------------------------------------------------------------------*/
const TMP_DIR = path.join(__dirname, "../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function computeChecksum(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function simulateCorruption(filePath: string) {
  const fd = fs.openSync(filePath, "r+");
  const buf = Buffer.alloc(8, 0xaa);
  fs.writeSync(fd, buf, 0, buf.length, 50);
  fs.closeSync(fd);
}

/* -----------------------------------------------------------------------
   🧪 Test Suite
------------------------------------------------------------------------*/
describe("🔐 Backup Encryption → Decryption Integrity", () => {
  let backupPath: string;
  let encryptedPath: string;
  let decryptedPath: string;
  let encryptionKey: string;

  beforeAll(async () => {
    logger.info("[TEST] Preparing encryption test environment...");
    encryptionKey = process.env.BACKUP_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

    // Seed minimal DB data to backup
    await prisma.user.create({
      data: {
        id: "enc-test-user",
        email: "encrypt@test.com",
        name: "Encrypt Test",
      },
    });

    backupPath = await runFullBackup();
    expect(fs.existsSync(backupPath)).toBe(true);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    logger.info("[TEST] Prisma disconnected.");
  });

  /* -----------------------------------------------------------------
     1️⃣ Encrypt backup file
  ----------------------------------------------------------------- */
  test("should encrypt backup file using AES-256-CBC", async () => {
    const { spawnSync } = require("child_process");
    const encOut = backupPath.replace(".zip", ".enc");
    const metaPath = `${encOut}.meta`;

    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, "sha256");

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const input = fs.createReadStream(backupPath);
    const output = fs.createWriteStream(encOut);

    input.pipe(cipher).pipe(output);

    await new Promise((resolve) => output.on("finish", resolve));

    fs.writeFileSync(metaPath, JSON.stringify({ iv: iv.toString("hex"), salt: salt.toString("hex") }));

    expect(fs.existsSync(encOut)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    encryptedPath = encOut;
    logger.info("[TEST] ✅ Backup file encrypted successfully.");
  });

  /* -----------------------------------------------------------------
     2️⃣ Validate checksum difference (encryption changes file)
  ----------------------------------------------------------------- */
  test("should have different checksum after encryption", () => {
    const checksumOriginal = computeChecksum(backupPath);
    const checksumEncrypted = computeChecksum(encryptedPath);

    expect(checksumEncrypted).not.toBe(checksumOriginal);
    logger.info("[TEST] 🔍 Checksum comparison validated (encryption modified file).");
  });

  /* -----------------------------------------------------------------
     3️⃣ Decrypt and verify checksum restored
  ----------------------------------------------------------------- */
  test("should decrypt backup and match original checksum", async () => {
    decryptedPath = await decryptFile(encryptedPath, encryptionKey);
    const checksumOriginal = computeChecksum(backupPath);
    const checksumDecrypted = computeChecksum(decryptedPath);

    expect(checksumDecrypted).toBe(checksumOriginal);
    logger.info("[TEST] ✅ Decryption successful and checksum restored.");
  });

  /* -----------------------------------------------------------------
     4️⃣ Detect corrupted encrypted file
  ----------------------------------------------------------------- */
  test("should fail to decrypt corrupted backup file", async () => {
    const corruptedPath = encryptedPath.replace(".enc", ".corrupt.enc");
    fs.copyFileSync(encryptedPath, corruptedPath);
    simulateCorruption(corruptedPath);

    let errorCaught = false;
    try {
      await decryptFile(corruptedPath, encryptionKey);
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toMatch(/bad decrypt|wrong final block|invalid/i);
      logger.info("[TEST] ⚠️ Corruption detection working as expected.");
    }
    expect(errorCaught).toBe(true);
  });

  /* -----------------------------------------------------------------
     5️⃣ Cleanup test artifacts
  ----------------------------------------------------------------- */
  afterAll(() => {
    [backupPath, encryptedPath, decryptedPath].forEach((file) => {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    });
    logger.info("[TEST] 🧹 Encryption test files cleaned up.");
  });
});