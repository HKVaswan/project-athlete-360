/**
 * src/lib/sentry.ts
 * -------------------------------------------------------------
 * Enterprise-grade Sentry integration.
 *
 * Features:
 *  - Auto-initialized error + performance monitoring
 *  - Environment, release & user tagging
 *  - Express middleware support (request + error tracking)
 *  - Graceful fallback if Sentry DSN is not provided
 *  - Advanced filtering to avoid logging sensitive data
 *  - Works across all environments (prod, staging, dev)
 */

import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";
import { config } from "../config";
import logger from "../logger";

/**
 * Initialize Sentry — safe & environment-aware.
 */
export const initSentry = () => {
  try {
    if (!config.sentryDsn) {
      logger.warn("⚠️ Sentry DSN not found. Skipping Sentry initialization.");
      return;
    }

    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.env || "development",
      release: config.appVersion || "v1.0.0",
      integrations: [
        // Enables request & tracing performance tracking
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app: undefined }), // app will be bound later
        new ProfilingIntegration(),
      ],
      tracesSampleRate: config.sentrySampleRate || 0.5, // 50% of requests for perf monitoring
      profilesSampleRate: config.sentryProfileRate || 0.2,
      maxBreadcrumbs: 100,
      attachStacktrace: true,
      normalizeDepth: 5,
      beforeSend(event) {
        // Sanitize sensitive data before sending to Sentry
        if (event.request?.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }
        return event;
      },
    });

    logger.info("✅ Sentry initialized successfully");
  } catch (err: any) {
    logger.error("❌ Failed to initialize Sentry:", err.message);
  }
};

/**
 * Middleware for request tracing (attach user/session context)
 */
export const sentryRequestHandler = Sentry.Handlers.requestHandler({
  user: ["id", "email", "role"],
  ip: true,
});

/**
 * Middleware for performance tracing (automatically creates spans)
 */
export const sentryTracingHandler = Sentry.Handlers.tracingHandler();

/**
 * Middleware for catching and reporting errors
 */
export const sentryErrorHandler = Sentry.Handlers.errorHandler({
  shouldHandleError(error) {
    // Only handle operational errors (ignore expected client errors)
    const ignoredStatuses = [400, 401, 403, 404];
    return !ignoredStatuses.includes((error as any)?.status);
  },
});

/**
 * Capture custom exceptions anywhere in codebase
 */
export const captureException = (error: any, context?: Record<string, any>) => {
  try {
    if (!config.sentryDsn) {
      logger.error(`⚠️ [Fallback] Exception captured: ${error.message}`);
      return;
    }

    Sentry.captureException(error, { extra: context });
  } catch (err) {
    logger.error("⚠️ Failed to capture Sentry exception:", err);
  }
};

/**
 * Capture custom events, e.g. AI performance anomaly or DB lag
 */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = "info") => {
  try {
    if (!config.sentryDsn) return;
    Sentry.captureMessage(message, level);
  } catch (err) {
    logger.error("⚠️ Failed to send Sentry message:", err);
  }
};

/**
 * Gracefully flush Sentry before shutdown
 */
export const flushSentry = async () => {
  try {
    if (!config.sentryDsn) return;
    await Sentry.close(2000); // 2s timeout
    logger.info("🧹 Sentry flushed successfully before shutdown.");
  } catch (err) {
    logger.warn("⚠️ Sentry flush failed on shutdown.");
  }
};

export default Sentry;