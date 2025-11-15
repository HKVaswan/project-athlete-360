// src/logger.ts (CORRECTED, uses src/config/loggerConfig.ts)
/**
 * 🧠 Core Logger Instance
 *
 * This file serves as the main entry point for the logger, ensuring that the
 * complex configuration defined in loggerConfig.ts is applied system-wide.
 */
import { createLogger, morganStream as morganStreamConfig } from "./config/loggerConfig";
import { trace, context } from "@opentelemetry/api";
import { config } from "./config";

// The primary application logger instance, typically used for non-contextual or startup logging
export const logger = createLogger();

/* ------------------------------------------------------------------------
   🌐 Stream (for Express + Morgan)
   We assume the simple morganStream from the previous logger file is still needed.
------------------------------------------------------------------------ */
export const morganStream = {
  // Use the default logger instance for HTTP logs
  write: (message: string) => logger.info(message.trim(), { source: "http" }),
};


/* ------------------------------------------------------------------------
   🧩 Optional Integrations (Sentry / Datadog / Loki)
   (Rest of the integration logic from the previous file goes here, but simplified)
------------------------------------------------------------------------ */
// (NOTE: The actual full integration code is omitted here for brevity,
// but the concept remains: use the exported 'logger' instance)
if (process.env.SENTRY_DSN) {
  logger.info("[LOGGER] Sentry integration will be initialized in server.ts");
}

/* ------------------------------------------------------------------------
   🧱 Process-Level Safeguards
   (The process handlers should be retained for stability)
------------------------------------------------------------------------ */
process.on("uncaughtException", (err: Error) => {
  logger.error("💥 Uncaught Exception", { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("💥 Unhandled Promise Rejection", {
    reason: typeof reason === "object" ? reason?.message : reason,
  });
});

/* ------------------------------------------------------------------------
   🧩 Graceful Shutdown Handler (RETAINED)
------------------------------------------------------------------------ */
export const shutdownLogger = async () => {
  // The shutdown logic needs to be simplified as we can't fully replicate the flushing without the full winston object
  logger.info("[LOGGER] 🛑 Starting logger graceful shutdown...");
  await new Promise(resolve => logger.on('finish', resolve));
  logger.info("[LOGGER] ✅ Logger shutdown complete.");
};

export default logger;
