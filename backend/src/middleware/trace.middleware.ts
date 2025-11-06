// src/middleware/trace.middleware.ts
/**
 * Enterprise-grade HTTP tracing middleware (OpenTelemetry)
 *
 * Responsibilities:
 *  - Extract trace context from incoming request headers (W3C traceparent)
 *  - Start a root span for each HTTP request
 *  - Attach traceId/spanId/requestId to req for logs & downstream propagation
 *  - Record errors and response status on the span
 *  - Ensure span finishes exactly once (finish on response end or error)
 *
 * Usage:
 *   import { tracingMiddleware, wrapHandlerWithSpan } from "../middleware/trace.middleware";
 *   app.use(tracingMiddleware);
 *   app.get("/api/...", wrapHandlerWithSpan(async (req, res) => { ... }));
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { context, propagation, trace, Span, SpanStatusCode, SpanKind } from "@opentelemetry/api";
import { randomUUID } from "crypto";
import logger from "../logger";
import { recordRequestMetrics } from "../lib/core/metrics";

const tracer = trace.getTracer("pa360.http");

/**
 * Extend Express Request to carry tracing metadata.
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      traceId?: string;
      spanId?: string;
      otelSpan?: Span;
    }
  }
}

/**
 * Helper — safely end span once
 */
function finishSpan(span: Span | undefined, statusCode: number, err?: any) {
  if (!span) return;
  try {
    span.setAttribute("http.status_code", statusCode);
    if (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err && err.message) || String(err) });
    } else if (statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.UNSET });
    }
  } catch (e) {
    // swallow attribute errors
  } finally {
    try {
      span.end();
    } catch {}
  }
}

/**
 * Express middleware: start/propagate trace for each incoming HTTP request
 */
export const tracingMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // ensure requestId exists (other middleware may also attach one)
  const requestId = (req as any).requestId || req.headers["x-request-id"] || randomUUID();
  req.requestId = String(requestId);

  // Extract incoming context (W3C traceparent etc.)
  const extractedContext = propagation.extract(context.active(), req.headers);

  // Start a root span within the extracted context
  context.with(extractedContext, () => {
    const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": req.method,
        "http.route": req.route ? String(req.route.path) : req.path,
        "http.url": req.originalUrl,
        "http.target": req.path,
        "http.host": req.headers.host,
        "http.scheme": req.protocol,
        "http.user_agent": String(req.headers["user-agent"] || "unknown"),
        "request.id": req.requestId,
        "env": process.env.NODE_ENV || "development",
        "service.name": "project-athlete-360-backend",
      },
    });

    // Attach span to request for downstream usage
    req.otelSpan = span;
    const spanContext = span.spanContext();
    req.traceId = spanContext.traceId;
    req.spanId = spanContext.spanId;

    // Add trace identifiers to logs for easy correlation
    logger.defaultMeta = {
      ...((logger as any).defaultMeta || {}),
      traceId: req.traceId,
      requestId: req.requestId,
    };

    // Bind the request/response lifecycle to this context
    const reqCtx = trace.setSpan(context.active(), span);
    context.bind(req, reqCtx);
    context.bind(res, reqCtx);

    const startHr = process.hrtime.bigint();

    // Ensure we finish span when response ends
    const onFinish = () => {
      try {
        const durationNs = Number(process.hrtime.bigint() - startHr);
        const durationSec = durationNs / 1_000_000_000;
        span.setAttribute("http.response_content_length", Number(res.getHeader("content-length") || 0));
        span.setAttribute("http.status_code", res.statusCode);
        span.setAttribute("http.elapsed_seconds", durationSec);

        // record simple request metrics (non-blocking)
        try {
          recordRequestMetrics(req.method, req.route ? String(req.route.path) : req.path, res.statusCode, durationSec);
        } catch (mErr) {
          // don't fail on metrics
          logger.debug("[tracing] recordRequestMetrics failed", { err: mErr });
        }

        finishSpan(span, res.statusCode);
      } finally {
        cleanup();
      }
    };

    const onError = (err: any) => {
      try {
        span.recordException(err);
        finishSpan(span, (res.statusCode || 500), err);
      } finally {
        cleanup();
      }
    };

    // cleanup listeners
    const cleanup = () => {
      res.removeListener("finish", onFinish);
      res.removeListener("close", onFinish);
      res.removeListener("error", onError);
    };

    res.once("finish", onFinish);
    res.once("close", onFinish);
    res.once("error", onError);

    // continue to next middleware/route handler inside span context
    return context.with(reqCtx, () => next());
  });
};

/**
 * Helper wrapper for route handlers to ensure the handler runs inside current span context.
 * Also ensures any thrown errors are recorded on current span.
 *
 * Usage:
 *   router.get("/", wrapHandlerWithSpan(async (req, res) => { ... }));
 */
export const wrapHandlerWithSpan = <T extends (req: Request, res: Response) => Promise<any>>(
  handler: T,
  spanName?: string
): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Use existing span if present, otherwise start a child
    const parentSpan = req.otelSpan;
    const activeCtx = context.active();

    const work = async () => {
      let span: Span | undefined;
      try {
        if (parentSpan) {
          span = tracer.startSpan(spanName || `${req.method} ${req.path} handler`, {
            kind: SpanKind.INTERNAL,
            attributes: {
              "request.id": req.requestId,
              "http.route": req.route ? String(req.route.path) : req.path,
            },
          }, trace.setSpan(activeCtx, parentSpan));
        } else {
          span = tracer.startSpan(spanName || `${req.method} ${req.path} handler`);
        }

        // run handler inside span context
        return await context.with(trace.setSpan(activeCtx, span), async () => {
          return await handler(req, res);
        });
      } catch (err: any) {
        if (span) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) });
        }
        throw err;
      } finally {
        if (span) {
          try {
            span.end();
          } catch {}
        }
      }
    };

    // Execute and propagate errors to express error handler
    work().then(() => {}).catch(next);
  };
};

export default tracingMiddleware;