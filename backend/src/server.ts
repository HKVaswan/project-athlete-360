/**
 * src/server.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Startup Script
 *
 * Responsibilities:
 *  - Validate secrets & environment readiness
 *  - Connect database & essential services
 *  - Launch Express server (HTTP)
 *  - Handle graceful shutdown for all dependencies
 * --------------------------------------------------------------------------
 */

import http from "http";
import app from "./app";
import prisma from "./prismaClient";
import logger from "./logger";
import { config } from "./config";
import { assertCriticalSecrets } from "./utils/assertCriticalSecrets";
import { secretManagerService } from "./services/secretManager.service";
import { keyRotationService } from "./services/keyRotation.service";
import { reconciliationService } from "./services/reconciliation.service";

// ───────────────────────────────────────────────
// 🌍 Create HTTP Server
// ───────────────────────────────────────────────
const server = http.createServer(app);

// ───────────────────────────────────────────────
// 🚀 Startup Routine
// ───────────────────────────────────────────────
const startServer = async () => {
  try {
    logger.info("🚦 Initializing Project Athlete 360 backend...");

    // 1️⃣ Verify environment mode
    logger.info(`🔧 Environment: ${config.NODE_ENV}`);

    // 2️⃣ Load secrets from Secret Manager
    await secretManagerService.warmUp();
    logger.info("🔐 Secret Manager ready");

    // 3️⃣ Assert all critical secrets exist and are strong
    await assertCriticalSecrets();
    logger.info("✅ Secrets validated successfully");

    // 4️⃣ Connect to Database
    await prisma.$connect();
    logger.info("🗄️  Database connected");

    // 5️⃣ Validate key integrity
    await keyRotationService.validateSecrets();

    // 6️⃣ Optional: Background startup jobs
    setTimeout(async () => {
      try {
        // Periodic billing reconciliation every 12 hours
        await reconciliationService.runFullReconciliation();
        logger.info("💰 Initial reconciliation completed");
      } catch (e) {
        logger.warn("⚠️  Initial reconciliation skipped:", e);
      }
    }, 30_000); // delay by 30s after boot

    // 7️⃣ Start the Express Server
    server.listen(config.PORT, () => {
      logger.info(`🚀 Server running on port ${config.PORT} in ${config.NODE_ENV} mode`);
    });

    // 8️⃣ Graceful restart hook (PM2 / nodemon)
    process.on("SIGUSR2", () => {
      logger.info("♻️  Restarting server via SIGUSR2...");
      shutdown("SIGUSR2");
    });

    logger.info("✅ System initialization complete — ready for requests");
  } catch (error: any) {
    logger.error("❌ Fatal startup error:", error);
    process.exit(1);
  }
};

// ───────────────────────────────────────────────
// 🧹 Graceful Shutdown
// ───────────────────────────────────────────────
const shutdown = async (signal: string) => {
  try {
    logger.warn(`⚠️  Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      try {
        logger.info("🧩 HTTP server closed");
        await prisma.$disconnect();
        logger.info("🗄️  Database disconnected");
        logger.info("🧩 Graceful shutdown complete — exiting cleanly");
        process.exit(0);
      } catch (dbErr) {
        logger.error("❌ Error during DB disconnection:", dbErr);
        process.exit(1);
      }
    });
  } catch (err) {
    logger.error("❌ Unhandled shutdown error:", err);
    process.exit(1);
  }
};

// ───────────────────────────────────────────────
// ⚙️ Handle Global Signals
// ───────────────────────────────────────────────
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error("💥 Uncaught Exception:", err);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason: any) => {
  logger.error("💥 Unhandled Rejection:", reason);
  shutdown("unhandledRejection");
});

// ───────────────────────────────────────────────
// ▶️ Launch
// ───────────────────────────────────────────────
startServer();