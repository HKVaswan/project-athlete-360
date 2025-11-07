/**
 * src/integrations/sentry.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Sentry Bootstrap
 *
 * Features:
 *  - Centralized error aggregation & performance tracing
 *  - Deep OpenTelemetry integration (traceId → Sentry)
 *  - Filters non-critical noise and sensitive data
 *  - Safe fallback if Sentry DSN missing or network unreachable
 *  - Supports async context propagation for workers & API
 *  - Auto-captures unhandled exceptions and rejections
 *
 * Dependencies:
 *  - @sentry/node
 *  - @sentry/profiling-node
 *  - @opentelemetry/api (for trace correlation)
 * --------------------------------------------------------------------------
 */

import * as Sentry from "@sentry/node";
import * as SentryProfiling from "@sentry/profiling-node";
import { trace, context } from "@opentelemetry/api";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";

/* --------------------------------------------------------------------------
   ⚙️ Sentry Initialization Configuration
-------------------------------------------------------------------------- */
export const initSentry = () => {
  try {
    const DSN = process.env.SENTRY_DSN || config.sentry?.dsn;

    if (!DSN) {
      logger.warn("[SENTRY] DSN not found — skipping initialization.");
      return;
    }

    const env = config.nodeEnv || "development";

    Sentry.init({
      dsn: DSN,
      environment: env,
      release: process.env.APP_VERSION || "v1.0.0",
      tracesSampleRate: env === "production" ? 0.2 : 1.0,
      profilesSampleRate: env === "production" ? 0.1 : 1.0,
      integrations: [
        // Auto instrumentation
        new SentryProfiling.ProfilingIntegration(),
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.OnUncaughtException({ onFatalError: () => {} }),
        new Sentry.Integrations.OnUnhandledRejection(),
      ],
      beforeSend(event) {
        // Sanitize sensitive data
        if (event.request?.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }

        // Filter known noise or development logs
        if (event.message?.includes("ECONNRESET") || event.message?.includes("socket hang up")) {
          return null;
        }

        return event;
      },
    });

    logger.info(`[SENTRY] ✅ Initialized for ${env} environment`);

    // Capture any startup diagnostics
    Sentry.captureMessage("Sentry initialized successfully", "info");

    // Auto-capture unhandled errors globally
    process.on("uncaughtException", (err) => {
      logger.error("[SENTRY] Uncaught Exception", { error: err.message });
      captureException(err);
    });

    process.on("unhandledRejection", (reason: any) => {
      logger.error("[SENTRY] Unhandled Rejection", {
        reason: typeof reason === "object" ? reason?.message : reason,
      });
      captureException(reason);
    });
  } catch (err: any) {
    logger.error("[SENTRY] ❌ Initialization failed:", err.message);
  }
};

/* --------------------------------------------------------------------------
   🧩 Capture Exception / Error Helper
-------------------------------------------------------------------------- */
export const captureException = async (error: any, contextData?: Record<string, any>) => {
  try {
    const activeSpan = trace.getSpan(context.active());
    const traceId = activeSpan?.spanContext().traceId;

    const eventId = Sentry.captureException(error, {
      extra: {
        traceId,
        ...(contextData || {}),
        timestamp: new Date().toISOString(),
      },
      level: "error",
    });

    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "ERROR_CAPTURED",
      details: { traceId, eventId, message: error.message || String(error) },
    });

    logger.warn(`[SENTRY] 📡 Captured exception (trace: ${traceId || "none"})`);
  } catch (err: any) {
    logger.error("[SENTRY] Failed to capture exception:", err.message);
  }
};

/* --------------------------------------------------------------------------
   🧩 Capture Message / Event
-------------------------------------------------------------------------- */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = "info") => {
  try {
    const activeSpan = trace.getSpan(context.active());
    const traceId = activeSpan?.spanContext().traceId;
    const eventId = Sentry.captureMessage(message, { level, extra: { traceId } });
    logger.info(`[SENTRY] 📬 Logged message '${message}' (trace: ${traceId})`);
    return eventId;
  } catch (err: any) {
    logger.error("[SENTRY] captureMessage failed:", err.message);
  }
};

/* --------------------------------------------------------------------------
   🧠 Context Enhancer
-------------------------------------------------------------------------- */
export const withSentryScope = async (
  fn: () => Promise<any>,
  scopeData?: Record<string, any>
): Promise<any> => {
  return await Sentry.withScope(async (scope) => {
    const activeSpan = trace.getSpan(context.active());
    if (activeSpan) {
      scope.setTag("trace_id", activeSpan.spanContext().traceId);
    }

    if (scopeData) {
      for (const [k, v] of Object.entries(scopeData)) {
        scope.setTag(k, v);
      }
    }

    try {
      return await fn();
    } catch (err) {
      captureException(err, scopeData);
      throw err;
    }
  });
};

/* --------------------------------------------------------------------------
   🧹 Graceful Shutdown
-------------------------------------------------------------------------- */
export const shutdownSentry = async () => {
  try {
    await Sentry.close(2000);
    logger.info("[SENTRY] 🧹 Shutdown complete.");
  } catch (err: any) {
    logger.warn("[SENTRY] Shutdown warning:", err.message);
  }
};

/* --------------------------------------------------------------------------
   📦 Exports
-------------------------------------------------------------------------- */
export default {
  initSentry,
  captureException,
  captureMessage,
  withSentryScope,
  shutdownSentry,
};