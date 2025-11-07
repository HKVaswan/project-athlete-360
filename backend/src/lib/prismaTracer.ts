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

      try