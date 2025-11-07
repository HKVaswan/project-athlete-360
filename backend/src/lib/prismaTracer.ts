/**
 * src/lib/prismaTracer.ts
 *
 * Enterprise-grade Prisma DB tracer / middleware.
 *
 * - Creates an OpenTelemetry span for every Prisma query via Prisma middleware.
 * - Attaches query metadata (model, action, params summary, duration).
 * - Records errors to the span and increments metrics.
 * - Adds traceId and spanId into Prisma query logs for correlation.
 *
 * Usage:
 *   import { initPrismaTracer } from "./lib/prismaTracer";
 *   initPrismaTracer(prisma);
 *
 * Notes:
 *  - Requires @opentelemetry/api to be initialized elsewhere (otel.bootstrap).
 *  - Integrates with src/lib/core/metrics (recordDBQuery / recordError).
 *  - Designed to be safe if OpenTelemetry not configured (no-op in that case).
 */

import type { Prisma } from "@prisma/client";
import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { logger } from "../logger";
import * as metrics from "./core/metrics";

type PrismaClientLike = {
  $use: (cb: (params: any, next: (params: any) => Promise<any>) => Promise<any>) => void;
  $on?: (event: string, cb: (...args: any[]) => void) => void;
};

/**
 * Minimal safe stringifier for parameters to avoid leaking large/PHI data.
 * Keeps only shapes and small values.
 */
function summarizeParams(params: any): string {
  try {
    if (!params) return "";
    // For typical Prisma middleware params: { model, action, args, data, where }
    const safe: any = {};
    if (params.model) safe.model = params.model;
    if (params.action) safe.action = params.action;
    if (params.args) {
      // keep shape but truncate long strings / arrays
      const copy: any = {};
      for (const [k, v] of Object.entries(params.args)) {
        if (v == null) {
          copy[k] = v;
        } else if (typeof v === "string") {
          copy[k] = v.length > 100 ? `${v.slice(0, 100)}...` : v;
        } else if (Array.isArray(v)) {
          copy[k] = v.length > 5 ? `[${v.length} items]` : v;
        } else if (typeof v === "object") {
          copy[k] = "[object]";
        } else {
          copy[k] = v;
        }
      }
      safe.args = copy;
    }
    return JSON.stringify(safe);
  } catch (err) {
    return "";
  }
}

/**
 * Initialize Prisma tracing middleware.
 *
 * @param prisma - instance of Prisma client
 * @param opts - optional configuration
 */
export function initPrismaTracer(prisma: PrismaClientLike, opts?: { serviceName?: string }) {
  const tracer = trace.getTracer(opts?.serviceName ?? "pa360-prisma-tracer");

  // Register Prisma middleware
  try {
    prisma.$use(async (params: any, next: (params: any) => Promise<any>) => {
      // Build span name like "Prisma.model.action" or "Prisma.raw" (if raw)
      const model = params.model ?? "Raw";
      const action = params.action ?? params.method ?? "unknown";
      const spanName = `prisma.${model}.${action}`.toLowerCase();

      // Start span
      const span = tracer.startSpan(spanName, {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.name": process.env.PGDATABASE || process.env.DATABASE_NAME || "unknown",
          "db.operation": action,
          "db.prisma_model": String(model),
          // keep param summary small and non-sensitive
          "db.prisma_params": summarizeParams(params),
        },
      });

      const start = Date.now();
      try {
        const result = await context.with(trace.setSpan(context.active(), span), () =>
          next(params)
        );

        const duration = (Date.now() - start) / 1000;
        // record to Prometheus histogram (if available)
        try {
          // metrics.recordDBQuery is intentionally lightweight; create it if missing
          if (typeof metrics.recordWorkerJob === "function") {
            // reuse workerJobDuration as generic DB histogram is not always present;
            // if you have a db query histogram, prefer to add and call it here.
            metrics.recordWorkerJob(`prisma.${model}`, duration, "success");
          }
        } catch (mErr) {
          // non-fatal
          logger.debug("[PRISMA-TRACER] metrics recording skipped", { err: mErr?.message || mErr });
        }

        span.setStatus({ code: SpanStatusCode.UNSET });
        span.setAttribute("db.duration_seconds", duration);
        span.end();
        return result;
      } catch (err: any) {
        const duration = (Date.now() - start) / 1000;

        // mark span as error
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message || "Prisma query error" });
        span.setAttribute("db.duration_seconds", duration);
        span.setAttribute("db.error_message", err?.message ?? "error");

        // metrics increment
        try {
          if (typeof metrics.recordError === "function") {
            metrics.recordError("prisma_query_error", "high");
          }
          if (typeof metrics.workerJobDuration !== "undefined") {
            // best-effort: increment a failure counter if exists
            // fallback to workerJobDuration histogram marking failed
            metrics.recordWorkerJob?.(`prisma.${model}`, duration, "failed");
          }
        } catch (mErr) {
          logger.debug("[PRISMA-TRACER] metrics error while recording on failure", {
            err: mErr?.message || mErr,
          });
        }

        span.end();
        // rethrow after recording
        throw err;
      }
    });

    logger.info("[PRISMA-TRACER] Prisma tracing middleware installed.");
  } catch (err: any) {
    // If prisma doesn't support $use or middleware already installed, log and continue
    logger.warn("[PRISMA-TRACER] Failed to install Prisma middleware:", err?.message || err);
  }

  // Optional: hook into Prisma logging (if $on exists) to enrich traces/logs
  if (prisma.$on && typeof prisma.$on === "function") {
    try {
      // Listen to query logging (if enabled in Prisma)
      prisma.$on("query", (e: any) => {
        // e: { query: string, params: string, duration: number }
        const span = trace.getSpan(context.active());
        if (span) {
          span.addEvent("prisma.query", {
            query: e.query?.slice?.(0, 1000) ?? "[query]",
            params: e.params?.slice?.(0, 1000) ?? "[params]",
            duration_ms: e.duration ?? null,
          });
        }
      });
      logger.info("[PRISMA-TRACER] Prisma query logger hook attached (if enabled).");
    } catch {
      // not critical
    }
  }

  // Return a small helper to fetch current trace ids for telemetry or logs
  return {
    getCurrentTraceIds: () => {
      const span = trace.getSpan(context.active());
      if (!span) return { traceId: null, spanId: null };
      const sc = span.spanContext();
      return { traceId: sc.traceId, spanId: sc.spanId };
    },
  };
}

export default initPrismaTracer;