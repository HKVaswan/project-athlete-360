// src/server.ts
import http from "http";
import app from "./app";
import prisma from "./prismaClient";
import logger from "./logger";
import { config } from "./config";

// ───────────────────────────────
// 🌍 Create HTTP Server
// ───────────────────────────────
const server = http.createServer(app);

// ───────────────────────────────
// 🚀 Start Server
// ───────────────────────────────
const startServer = async () => {
  try {
    // ✅ Connect to Database
    await prisma.$connect();
    logger.info("✅ Database connected successfully");

    // ✅ Start Express App
    server.listen(config.PORT, () => {
      logger.info(
        `🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`
      );
    });

    // 💡 Optional: register for graceful restart in cluster mode
    process.on("SIGUSR2", () => {
      logger.info("♻️  Restarting server...");
      shutdown("SIGUSR2");
    });
  } catch (error) {
    logger.error("❌ Server failed to start:", error);
    process.exit(1);
  }
};

// ───────────────────────────────
// 🧹 Graceful Shutdown
// ───────────────────────────────
const shutdown = async (signal: string) => {
  try {
    logger.info(`⚠️  Received ${signal}. Closing server gracefully...`);
    server.close(async () => {
      logger.info("🧩 HTTP server closed");
      await prisma.$disconnect();
      logger.info("🗄️  Database disconnected");
      process.exit(0);
    });
  } catch (err) {
    logger.error("❌ Error during shutdown:", err);
    process.exit(1);
  }
};

// ───────────────────────────────
// ⚙️ Handle Termination Signals
// ───────────────────────────────
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

// ───────────────────────────────
// ▶️ Initialize Server
// ───────────────────────────────
startServer();
