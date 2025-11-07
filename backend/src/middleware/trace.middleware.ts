// src/middleware/trace.middleware.ts
/**
 * Enterprise-grade HTTP tracing middleware (OpenTelemetry)
 *
 * Responsibilities:
 *  - Extract and propagate W3C and legacy trace headers
 *  - Start a root span for every incoming HTTP request
 *  - Attach traceId, spanId, and requestId to req and logs
 *  - Record request latency, status, and errors
 *  - Finish span safely (once per request)
 *
 * Usage:
 *   import { tracingMiddleware, wrapHandlerWithSpan } from "../middleware/trace.middleware";
 *   app.use(tracingMiddleware);
 *   app.get("/api/...", wrapHandlerWithSpan(async (req, res) => { ... }));
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  context,
  propagation,
  trace,
  Span,
  SpanStatusCode,
  SpanKind,
} from "@opentelemetry/api";
import { randomUUID } from "crypto";
import logger from "../logger";
import { recordRequestMetrics } from "../lib/core/metrics";

/**
 * Tracer for HTTP layer
 */
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

/* ------------------------------------------------------------------------
   🧩 Helper: Finish span safely (ensures single end)
------------------------------------------------------------------------ */
function finishSpan(span: Span | undefined, statusCode: number, err?: any) {
  if (!span || (span as any)._ended) return;
  try {
    span.setAttribute("http.status_code", statusCode);

    if (err) {
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err && err.message) || String(err),
      });
    } else if (statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
  } catch (e) {
    logger.debug("[trace.middleware] Failed to set span attributes", { e });
  } finally {
    try {
      (span as any)._ended = true;
      span.end();
    } catch {}
  }
}

/* ------------------------------------------------------------------------
   🛰 Middleware: Tracing for all HTTP requests
------------------------------------------------------------------------ */
export const tracingMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.requestId = String(requestId);

  // Extract context (supports W3C + B3 headers)
  const extractedContext = propagation.extract(context.active(), req.headers);

  // Begin root span in extracted context
  context.with(extractedContext, () => {
    const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": req.method,
        "http.url": req.originalUrl,
        "http.route": req.route ? String(req.route.path) : req.path,
        "http.target": req.path,
        "http.host": req.headers.host,
        "http.scheme": req.protocol,
        "http.user_agent": String(req.headers["user-agent"] || "unknown"),
        "request.id": req.requestId,
        "service.name": "project-athlete-360-backend",
        "env": process.env.NODE_ENV || "development",
        ...(req.user && { "user.id": (req.user as any).id }),
      },
    });

    req.otelSpan = span;
    const spanCtx = span.spanContext();
    req.traceId = spanCtx.traceId;
    req.spanId = spanCtx.spanId;

    // Inject trace IDs into logger metadata for correlation
    logger.defaultMeta = {
      ...((logger as any).defaultMeta || {}),
      traceId: req.traceId,
      requestId: req.requestId,
    };

    const startHr = process.hrtime.bigint();

    const onFinish = () => {
      cleanup();
      try {
        const durationNs = Number(process.hrtime.bigint() - startHr);
        const durationSec = durationNs / 1_000_000_000;
        span.setAttribute("http.elapsed_seconds", durationSec);
        span.setAttribute(
          "http.response_content_length",
          Number(res.getHeader("content-length") || 0)
        );

        queueMicrotask(() => {
          try {
            recordRequestMetrics(
              req.method,
              req.route ? String(req.route.path) : req.path,
              res.statusCode,
              durationSec
            );
          } catch (err) {
            logger.debug("[trace.middleware] Metric record failed", { err });
          }
        });

        finishSpan(span, res.statusCode);
      } catch (e) {
        logger.error("[trace.middleware] Error finishing span", { e });
      }
    };

    const onError = (err: any) => {
      cleanup();
      finishSpan(span, res.statusCode || 500, err);
    };

    const cleanup = () => {
      res.removeListener("finish", onFinish);
      res.removeListener("close", onFinish);
      res.removeListener("error", onError);
    };

    res.once("finish", onFinish);
    res.once("close", onFinish);
    res.once("error", onError);

    const reqCtx = trace.setSpan(context.active(), span);
    context.with(reqCtx, () => next());
  });
};

/* ------------------------------------------------------------------------
   🧭 Helper: Wrap async route handlers
------------------------------------------------------------------------ */
export const wrapHandlerWithSpan = <
  T extends (req: Request, res: Response) => Promise<any>
>(
  handler: T,
  spanName?: string
): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const parentSpan = req.otelSpan;
    const activeCtx = context.active();

    const execute = async () => {
      let span: Span | undefined;
      try {
        const spanContext = parentSpan
          ? trace.setSpan(activeCtx, parentSpan)
          : activeCtx;

        span = tracer.startSpan(
          spanName || `${req.method} ${req.path} handler`,
          { kind: SpanKind.INTERNAL },
          spanContext
        );

        return await context.with(trace.setSpan(activeCtx, span), () =>
          handler(req, res)
        );
      } catch (err: any) {
        if (span) {
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message || String(err),
          });
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

    execute().catch(next);
  };
};

export default tracingMiddleware;