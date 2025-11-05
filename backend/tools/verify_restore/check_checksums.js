/**
 * tools/verify_restore/check_checksums.js
 * ---------------------------------------------------------------------
 * 🔒 Backup & Restore Integrity Verification (Checksum Validation)
 *
 * Purpose:
 *   - Verify SHA-256 checksums for database tables after restore.
 *   - Compare against baseline manifest generated pre-backup.
 *   - Detect silent corruption or incomplete restoration.
 *
 * Features:
 *   ✅ Uses PostgreSQL checksum hash (aggregated row data hash)
 *   ✅ Generates JSON integrity report
 *   ✅ Exits with non-zero code if mismatches found (CI/CD safe)
 *   ✅ Supports large tables via chunked hashing
 * ---------------------------------------------------------------------
 */

import { Client } from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not defined in environment variables.");
  process.exit(1);
}

const CHECKSUM_MANIFEST_PATH =
  process.env.CHECKSUM_MANIFEST || "tools/verify_restore/checksum_manifest.json";
const OUTPUT_PATH =
  process.env.CHECKSUM_REPORT || "tools/verify_restore/restore_checksum_report.json";

const CHUNK_LIMIT = Number(process.env.CHECKSUM_CHUNK_LIMIT || 5000);

/* ---------------------------------------------------------------------
   🧮 Utility — Compute Row-Based Table Hash
------------------------------------------------------------------------*/
async function computeTableChecksum(client, tableName) {
  try {
    // Stream large tables in chunks to avoid memory explosion
    let offset = 0;
    const hasher = crypto.createHash("sha256");

    while (true) {
      const { rows } = await client.query(
        `SELECT * FROM "${tableName}" ORDER BY 1 OFFSET $1 LIMIT $2`,
        [offset, CHUNK_LIMIT]
      );

      if (rows.length === 0) break;

      for (const row of rows) {
        hasher.update(JSON.stringify(row));
      }

      offset += CHUNK_LIMIT;
    }

    return hasher.digest("hex");
  } catch (err) {
    console.error(`❌ Failed to compute checksum for ${tableName}: ${err.message}`);
    throw err;
  }
}

/* ---------------------------------------------------------------------
   🧠 Main Verification Routine
------------------------------------------------------------------------*/
async function main() {
  console.log("🧩 Starting checksum verification...");

  if (!fs.existsSync(CHECKSUM_MANIFEST_PATH)) {
    console.error(`❌ Missing baseline checksum manifest at: ${CHECKSUM_MANIFEST_PATH}`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(CHECKSUM_MANIFEST_PATH, "utf8"));
  const tables = Object.keys(baseline);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const results = {};
  let mismatches = 0;

  for (const table of tables) {
    try {
      console.log(`🔹 Checking table: ${table} ...`);
      const currentChecksum = await computeTableChecksum(client, table);
      const baselineChecksum = baseline[table];

      const match = currentChecksum === baselineChecksum;
      results[table] = {
        match,
        currentChecksum,
        baselineChecksum,
        status: match ? "OK" : "MISMATCH",
      };

      if (!match) {
        mismatches++;
        console.warn(`⚠️  Mismatch in ${table}`);
      }
    } catch (err) {
      results[table] = { error: err.message };
      mismatches++;
    }
  }

  await client.end();

  const summary = {
    timestamp: new Date().toISOString(),
    verifiedTables: tables.length,
    mismatches,
    integrityPassed: mismatches === 0,
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));

  console.log(`📁 Report saved: ${OUTPUT_PATH}`);

  if (mismatches > 0) {
    console.error(`❌ Integrity verification FAILED (${mismatches} mismatch[es])`);
    process.exit(2);
  }

  console.log("✅ All checksums verified successfully — restore integrity confirmed.");
  process.exit(0);
}

/* ---------------------------------------------------------------------
   🚀 Run Script
------------------------------------------------------------------------*/
main().catch((err) => {
  console.error("❌ Fatal error in checksum verification:", err);
  process.exit(1);
});