/**
 * src/workers/traceContext.ts
 * --------------------------------------------------------------------------
 * Enterprise-grade Trace Context Propagation for Background Workers
 *
 * Purpose:
 *  - Ensures traceId and spanId are preserved across asynchronous systems
 *    (e.g., job queues, event buses, AI pipelines).
 *  - Allows full end-to-end tracing from API → Queue → Worker → DB → Storage.
 *
 * Features:
 *  - Extracts trace context from OpenTelemetry spans.
 *  - Injects trace headers into job payloads or metadata.
 *  - Restores context within worker jobs so spans remain connected.
 *  - Automatically attaches trace info to logs for correlation.
 * --------------------------------------------------------------------------
 */

import { context, trace, propagation, Span, ROOT_CONTEXT } from "@opentelemetry/api";
import { logger } from "../logger";

/**
 * Type definition for a job-like object
 * (Supports BullMQ, custom queue, or internal message objects)
 */
export interface TraceableJob<T = any> {
  id?: string;
  name?: string;
  data: T;
  opts?: Record<string, any>;
  traceContext?: Record<string, string>;
}

/* ---------------------------------------------------------------------------
 * 🧠 Inject Trace Context — called when job is created
 * ------------------------------------------------------------------------- */
export const injectTraceContext = (job: TraceableJob) => {
  try {
    const span = trace.getSpan(context.active());
    if (!span) return;

    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    job.traceContext = carrier;

    const sc = span.spanContext();
    logger.debug("[TRACE] Injected trace context into job", {
      traceId: sc.traceId,
      spanId: sc.spanId,
      jobName: job.name,
    });
  } catch (err: any) {
    logger.warn("[TRACE] Failed to inject trace context", { error: err.message });
  }
};

/* ---------------------------------------------------------------------------
 * 🧩 Extract Trace Context — called inside worker before processing job
 * ------------------------------------------------------------------------- */
export const extractTraceContext = (job: TraceableJob): Span | null => {
  try {
    const ctx = job.traceContext
      ? propagation.extract(ROOT_CONTEXT, job.traceContext)
      : ROOT_CONTEXT;

    const tracer = trace.getTracer("pa360-worker");
    const span = tracer.startSpan(`worker.${job.name || "unnamed"}`, undefined, ctx);

    // Bind active context so downstream async calls retain it
    const activeCtx = trace.setSpan(ctx, span);
    propagation.inject(activeCtx, job.traceContext ?? {});

    logger.debug("[TRACE] Extracted and activated worker trace context", {
      traceId: span.spanContext().traceId,
      job: job.name,
    });

    return span;
  } catch (err: any) {
    logger.error("[TRACE] Failed to extract worker trace context", { error: err.message });
    return null;
  }
};

/* ---------------------------------------------------------------------------
 * 🧾 Finalize span safely after job completion
 * ------------------------------------------------------------------------- */
export const finalizeTraceSpan = (
  span: Span | null,
  result: "success" | "failed",
  error?: Error
) => {
  if (!span) return;

  try {
    if (result === "failed" && error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message }); // ERROR
    } else {
      span.setStatus({ code: 1 }); // OK
    }

    span.end();

    logger.debug("[TRACE] Worker span finalized", {
      traceId: span.spanContext().traceId,
      status: result,
    });
  } catch (err: any) {
    logger.error("[TRACE] Failed to finalize span", { error: err.message });
  }
};

/* ---------------------------------------------------------------------------
 * 🧩 Helper: Wrap worker job execution in a tracing context
 * ------------------------------------------------------------------------- */
/**
 * Wraps any async worker function so that:
 *  - trace context is extracted automatically
 *  - spans are started and ended safely
 *  - exceptions are recorded
 */
export const withTraceContext =
  <T = any>(
    jobName: string,
    handler: (job: TraceableJob<T>, span?: Span) => Promise<any>
  ) =>
  async (job: TraceableJob<T>) => {
    const span = extractTraceContext({ ...job, name: jobName });
    try {
      const result = await context.with(trace.setSpan(context.active(), span!), () =>
        handler(job, span!)
      );
      finalizeTraceSpan(span, "success");
      return result;
    } catch (err: any) {
      finalizeTraceSpan(span, "failed", err);
      throw err;
    }
  };