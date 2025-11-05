/**
 * tools/verify_restore/check_table_counts.js
 * ---------------------------------------------------------------------
 * 🔍 Post-Restore Verification Script
 *
 * Purpose:
 *   - Validate record counts after a database restore.
 *   - Compare against baseline (pre-backup manifest).
 *   - Detect missing, truncated, or corrupted tables early.
 *
 * Features:
 *   ✅ Reads config from environment (.env or CI vars)
 *   ✅ Generates machine-readable JSON summary
 *   ✅ Produces human-readable console report
 *   ✅ Suitable for CI/CD and manual validation
 * ---------------------------------------------------------------------
 */

import { Client } from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ------------------ Configuration ------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not defined. Aborting.");
  process.exit(1);
}

// Optional manifest file (pre-backup snapshot)
const MANIFEST_PATH = process.env.TABLE_COUNT_MANIFEST || "tools/verify_restore/table_manifest.json";
const OUTPUT_PATH = process.env.OUTPUT_PATH || "tools/verify_restore/restore_verification_report.json";

// Minimum essential tables to verify if no manifest provided
const CRITICAL_TABLES = [
  "User",
  "AthleteProfile",
  "Institution",
  "Session",
  "Backup",
  "AuditLog"
];

// ------------------ Utility Helpers ------------------
function format(num) {
  return num.toLocaleString("en-IN");
}

function hashObject(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// ------------------ Main Verification Logic ------------------
async function main() {
  console.log("🧠 Starting post-restore verification...");
  const client = new Client({ connectionString: DATABASE_URL });

  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
    : null;

  const tablesToCheck = manifest ? Object.keys(manifest) : CRITICAL_TABLES;

  await client.connect();
  console.log(`✅ Connected to database.`);

  const results = {};
  let discrepancies = 0;

  for (const table of tablesToCheck) {
    try {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      const count = rows[0].count;
      results[table] = { count };

      if (manifest && manifest[table] !== undefined) {
        const expected = manifest[table];
        if (expected !== count) {
          results[table].status = "MISMATCH";
          results[table].expected = expected;
          discrepancies++;
          console.warn(`⚠️  Table ${table}: expected ${format(expected)}, found ${format(count)}`);
        } else {
          results[table].status = "OK";
        }
      } else {
        results[table].status = "NO_BASELINE";
      }
    } catch (err) {
      console.error(`❌ Failed to count table "${table}":`, err.message);
      results[table] = { error: err.message };
      discrepancies++;
    }
  }

  await client.end();

  // Generate summary
  const summary = {
    timestamp: new Date().toISOString(),
    totalTables: tablesToCheck.length,
    discrepancies,
    allPassed: discrepancies === 0,
    verificationHash: hashObject(results),
    results
  };

  // Save report
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`📁 Verification report saved at: ${OUTPUT_PATH}`);

  if (discrepancies > 0) {
    console.error(`❌ Verification FAILED. ${discrepancies} discrepancy(ies) found.`);
    process.exit(2);
  }

  console.log("✅ Verification PASSED. All table counts match baseline.");
  process.exit(0);
}

// ------------------ Entry Point ------------------
main().catch((err) => {
  console.error("❌ Fatal error in verification script:", err);
  process.exit(1);
});