/**
 * tools/observability/trigger_alert_test.js
 * --------------------------------------------------------------------------
 * 🧨 Observability Alert Trigger Tool (Enterprise Edition)
 *
 * Purpose:
 *  - Simulate different alert scenarios to verify Sentry, Prometheus, and
 *    notification pipeline integration (Slack / PagerDuty / Email / SMS).
 *  - Useful for staging validation before production rollouts.
 *
 * Scenarios Supported:
 *  1️⃣ High CPU load (mock)
 *  2️⃣ Memory pressure
 *  3️⃣ Queue backlog spike
 *  4️⃣ Artificial error spike (Sentry + Prometheus error count)
 *  5️⃣ Database latency simulation
 * --------------------------------------------------------------------------
 */

import os from "os";
import { performance } from "perf_hooks";
import { setTimeout as delay } from "timers/promises";
import { captureException, captureMessage } from "../../src/integrations/sentry.bootstrap.js";
import { recordError, recordWorkerJob } from "../../src/lib/core/metrics.js";
import { logger } from "../../src/logger.js";
import { auditService } from "../../src/lib/audit.js";
import { telemetry } from "../../src/lib/telemetry.js";

const scenarios = {
  cpu: async () => {
    logger.info("[ALERT TEST] 🧠 Simulating high CPU usage...");
    const start = performance.now();
    while (performance.now() - start < 5000) {
      // Burn some CPU cycles for 5 seconds
      Math.sqrt(Math.random() * 1e9);
    }
    telemetry.record("cpu_usage_percent", 95);
    recordError("high_cpu_load", "warning");
    await captureMessage("Simulated High CPU usage alert", "warning");
    logger.info("[ALERT TEST] ✅ High CPU usage simulation done.");
  },

  memory: async () => {
    logger.info("[ALERT TEST] 🧠 Simulating memory pressure...");
    const data = new Array(100_000_000).fill("x");
    telemetry.record("memory_usage_percent", 92);
    recordError("memory_pressure", "critical");
    await captureMessage("Simulated High Memory Pressure alert", "error");
    await delay(2000);
    data.length = 0;
    logger.info("[ALERT TEST] ✅ Memory pressure simulation done.");
  },

  queue: async () => {
    logger.info("[ALERT TEST] 🎯 Simulating queue backlog...");
    for (let i = 0; i < 30; i++) {
      recordWorkerJob("telemetry", i);
    }
    recordError("queue_backlog_spike", "warning");
    await captureMessage("Simulated Queue Backlog Alert", "warning");
    logger.info("[ALERT TEST] ✅ Queue backlog simulation done.");
  },

  errors: async () => {
    logger.info("[ALERT TEST] 💥 Simulating error spike...");
    for (let i = 0; i < 10; i++) {
      try {
        throw new Error(`Synthetic Error #${i + 1}`);
      } catch (err) {
        recordError("synthetic_error_spike", "medium");
        await captureException(err, { scenario: "error_spike_test" });
      }
      await delay(300);
    }
    logger.info("[ALERT TEST] ✅ Error spike simulation done.");
  },

  db: async () => {
    logger.info("[ALERT TEST] 🧱 Simulating DB latency...");
    const fakeLatency = 800; // ms
    telemetry.record("db_latency_ms", fakeLatency);
    recordError("db_latency_high", "warning");
    await captureMessage("Simulated Database Latency Alert", "warning");
    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "ALERT_TEST",
      details: { scenario: "db_latency", fakeLatency },
    });
    logger.info("[ALERT TEST] ✅ DB latency simulation done.");
  },
};

/* --------------------------------------------------------------------------
   🧩 CLI Entrypoint
-------------------------------------------------------------------------- */
const scenario = process.argv[2];

if (!scenario || !Object.keys(scenarios).includes(scenario)) {
  console.log(`
Usage: node tools/observability/trigger_alert_test.js [scenario]

Available scenarios:
  - cpu       → Simulate high CPU usage alert
  - memory    → Simulate memory pressure alert
  - queue     → Simulate queue backlog alert
  - errors    → Simulate error spike alert
  - db        → Simulate database latency alert

Examples:
  node tools/observability/trigger_alert_test.js cpu
  node tools/observability/trigger_alert_test.js errors
`);
  process.exit(1);
}

(async () => {
  logger.info(`[ALERT TEST] 🚀 Starting scenario: ${scenario}`);
  try {
    await scenarios[scenario]();
    logger.info(`[ALERT TEST] ✅ Scenario completed: ${scenario}`);
  } catch (err) {
    logger.error(`[ALERT TEST] ❌ Scenario failed: ${err.message}`);
    await captureException(err, { scenario });
  } finally {
    logger.info(`[ALERT TEST] 🧩 Run complete. Host: ${os.hostname()}`);
    process.exit(0);
  }
})();