/**
 * src/integrations/sentry.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Sentry Bootstrap (v2.1)
 *
 * Enhancements in this version:
 *  - Dynamic sampling rates (via env vars)
 *  - Auto tags: service name, version, region
 *  - Optional breadcrumbs from logger integration
 *  - Request body sanitization (passwords, tokens)
 *  - Better worker safety for async traces
 * --------------------------------------------------------------------------
 */

import * as Sentry from "@sentry/node";
import * as SentryProfiling from "@sentry/profiling-node";
import { trace, context } from "@opentelemetry/api";
import { logger } from "../logger";
import { config } from "../config";
import { auditService } from "../services/audit.service";

/* --------------------------------------------------------------------------
   ⚙️ Initialization Configuration
-------------------------------------------------------------------------- */
export const initSentry = () => {
  try {
    const DSN = process.env.SENTRY_DSN || config.sentry?.dsn;

    if (!DSN) {
      logger.warn("[SENTRY] DSN not found — skipping initialization.");
      return;
    }

    const env = config.nodeEnv || "development";
    const tracesRate = Number(process.env.SENTRY_TRACES_RATE ?? (env === "production" ? 0.2 : 1.0));
    const profilesRate = Number(process.env.SENTRY_PROFILES_RATE ?? (env === "production" ? 0.1 : 1.0));

    Sentry.init({
      dsn: DSN,
      environment: env,
      release: config.version || process.env.APP_VERSION || "v1.0.0",
      tracesSampleRate: tracesRate,
      profilesSampleRate: profilesRate,
      integrations: [
        new SentryProfiling.ProfilingIntegration(),
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.OnUncaughtException({ onFatalError: () => {} }),
        new Sentry.Integrations.OnUnhandledRejection(),
      ],
      beforeSend(event) {
        // 🧹 Sanitize sensitive headers
        if (event.request?.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }

        // 🧹 Sanitize sensitive body fields
        if (event.request?.data && typeof event.request.data === "object") {
          const clean = { ...event.request.data };
          ["password", "token", "accessToken", "secret"].forEach((f) => delete (clean as any)[f]);
          event.request.data = clean;
        }

        // 🔇 Filter transient network errors
        if (event.message?.includes("ECONNRESET") || event.message?.includes("socket hang up")) {
          return null;
        }

        return event;
      },
    });

    // 🌍 Global context
    Sentry.setTag("service", config.serviceName || "pa360-backend");
    Sentry.setTag("version", config.version || "1.0.0");
    Sentry.setTag("region", config.region || "global");

    logger.info(`[SENTRY] ✅ Initialized (${env}) | Traces=${tracesRate}, Profiles=${profilesRate}`);

    Sentry.captureMessage("Sentry initialized successfully", "info");

    // 🧩 Global fail-safes
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
   🧩 Capture Exception Helper
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
   🧩 Capture Message Helper
-------------------------------------------------------------------------- */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = "info") => {
  try {
    const activeSpan = trace.getSpan(context.active());
    const traceId = activeSpan?.spanContext().traceId;
    const eventId = Sentry.captureMessage(message, { level, extra: { traceId } });

    // Breadcrumb for future traces
    Sentry.addBreadcrumb({ message, level, category: "system" });

    logger.info(`[SENTRY] 📬 Logged message '${message}' (trace: ${traceId})`);
    return eventId;
  } catch (err: any) {
    logger.error("[SENTRY] captureMessage failed:", err.message);
  }
};

/* --------------------------------------------------------------------------
   🧠 Safe Scope Wrapper (workers, background jobs, etc.)
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