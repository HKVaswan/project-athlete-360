/**
 * src/lib/prismaTracer.ts
 * --------------------------------------------------------------------------
 * 🧭 Enterprise Prisma Tracing Middleware for Project Athlete 360
 *
 * Responsibilities:
 *  - Creates OpenTelemetry spans for all Prisma DB operations.
 *  - Records query latency, model, action, and errors.
 *  - Exports metrics to Prometheus for DB latency & failure tracking.
 *  - Injects traceId/spanId into Prisma logs for observability.
 *
 * Usage:
 *   import { initPrismaTracer } from "./lib/prismaTracer";
 *   initPrismaTracer(prisma);
 */

import type { Prisma } from "@prisma/client";
import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { logger } from "../logger";
import * as metrics from "./core/metrics";

type PrismaClientLike = {
  $use: (cb: (params: any, next: (params: any) => Promise<any>) => Promise<any>) => void;
  $on?: (event: string, cb: (...args: any[]) => void) => void;
};

/* ------------------------------------------------------------------------
   🧩 Safe Parameter Summarizer (avoids leaking sensitive data)
------------------------------------------------------------------------ */
function summarizeParams(params: any): string {
  try {
    if (!params) return "";
    const safe: any = { model: params.model, action: params.action };
    if (params.args) {
      const trimmed: any = {};
      for (const [k, v] of Object.entries(params.args)) {
        if (v == null) trimmed[k] = v;
        else if (typeof v === "string") trimmed[k] = v.length > 80 ? v.slice(0, 80) + "..." : v;
        else if (Array.isArray(v)) trimmed[k] = `[${v.length} items]`;
        else if (typeof v === "object") trimmed[k] = "[object]";
        else trimmed[k] = v;
      }
      safe.args = trimmed;
    }
    return JSON.stringify(safe);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------------
   🚀 Initialize Prisma Tracing
------------------------------------------------------------------------ */
export function initPrismaTracer(prisma: PrismaClientLike, opts?: { serviceName?: string }) {
  const tracer = trace.getTracer(opts?.serviceName ?? "pa360-prisma");

  try {
    prisma.$use(async (params: any, next: (params: any) => Promise<any>) => {
      const model = params.model ?? "Raw";
      const action = params.action ?? params.method ?? "unknown";
      const spanName = `prisma.${model}.${action}`.toLowerCase();

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.name": process.env.PGDATABASE || process.env.DATABASE_NAME || "unknown",
          "db.operation": action,
          "db.prisma_model": String(model),
          "db.params.summary": summarizeParams(params),
          "env": process.env.NODE_ENV || "development",
        },
      });

      const startHr = process.hrtime.bigint();

      try {
        const result = await context.with(trace.setSpan(context.active(), span), () =>
          next(params)
        );

        const durationNs = Number(process.hrtime.bigint() - startHr);
        const durationSec = durationNs / 1_000_000_000;

        // Record DB query duration metric
        queueMicrotask(() => {
          try {
            if (typeof metrics.workerJobDuration === "object") {
              metrics.workerJobDuration.labels(`prisma.${model}`, "success", process.env.NODE_ENV || "unknown").observe(durationSec);
            }
          } catch (err) {
            logger.debug("[PRISMA-TRACER] metrics record skipped", { err });
          }
        });

        span.setAttribute("db.duration_seconds", durationSec);
        span.setStatus({ code: SpanStatusCode.OK });

        span.end();
        return result;
      } catch (err: any) {
        const durationNs = Number(process.hrtime.bigint() - startHr);
        const durationSec = durationNs / 1_000_000_000;

        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err?.message || "Prisma query error",
        });
        span.setAttribute("db.duration_seconds", durationSec);
        span.setAttribute("db.error_message", err?.message ?? "unknown");

        // Record metrics for error
        queueMicrotask(() => {
          try {
            metrics.recordError?.("prisma_query_error", "high");
            metrics.workerJobDuration?.labels(`prisma.${model}`, "failed", process.env.NODE_ENV || "unknown").observe(durationSec);
          } catch (mErr) {
            logger.debug("[PRISMA-TRACER] metrics error on failure", { err: mErr });
          }
        });

        span.end();
        throw err;
      }
    });

    logger.info("[PRISMA-TRACER] ✅ Prisma tracing middleware active");
  } catch (err: any) {
    logger.warn("[PRISMA-TRACER] ⚠️ Middleware install failed:", err?.message || err);
  }

  /* --------------------------------------------------------------------
     🧠 Prisma Query Logger Hook (optional)
  -------------------------------------------------------------------- */
  if (prisma.$on && typeof prisma.$on === "function") {
    try {
      prisma.$on("query", (e: any) => {
        const span = trace.getSpan(context.active());
        if (span) {
          span.addEvent("prisma.query", {
            query: e.query?.slice?.(0, 500) ?? "[query]",
            params: e.params?.slice?.(0, 200) ?? "[params]",
            duration_ms: e.duration ?? null,
          });
        }
        logger.debug("[PRISMA] Query executed", {
          traceId: span?.spanContext().traceId,
          model: e.target,
          duration: e.duration,
        });
      });
      logger.info("[PRISMA-TRACER] 🔍 Query logger attached (non-blocking)");
    } catch (err) {
      logger.debug("[PRISMA-TRACER] Query event binding skipped", { err });
    }
  }

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