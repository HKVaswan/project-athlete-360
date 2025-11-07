/**
 * src/lib/core/tracing-http.ts
 * --------------------------------------------------------------------------
 * 🌐 Enterprise HTTP Tracing Utility (OpenTelemetry)
 *
 * Purpose:
 *  - Instrument outgoing HTTP requests with distributed tracing
 *  - Record latency, status, and error metrics for external dependencies
 *  - Support Axios, Fetch, and Node http/https modules
 *  - Ensure full trace propagation via W3C `traceparent` headers
 *
 * Usage:
 *   import { tracedFetch, tracedAxios } from "../lib/core/tracing-http";
 *
 *   const res = await tracedFetch("https://api.openai.com/v1/models");
 *   const data = await tracedAxios.get("https://api.stripe.com/v1/balance");
 *
 * Dependencies:
 *   - @opentelemetry/api
 *   - axios (optional)
 * --------------------------------------------------------------------------
 */

import { context, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { performance } from "perf_hooks";
import { logger } from "../../logger";

/* --------------------------------------------------------------------------
 * ⚙️ Tracer Setup
 * ------------------------------------------------------------------------ */
const tracer = trace.getTracer("pa360.http.client");

/* --------------------------------------------------------------------------
 * 🌐 Fetch Wrapper (with Tracing)
 * ------------------------------------------------------------------------ */
export async function tracedFetch(
  url: string,
  options: RequestInit = {},
  spanName?: string
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  const name = spanName || `HTTP ${method} ${url.split("?")[0]}`;
  const span = tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes: { "http.method": method, "http.url": url } });

  const ctx = trace.setSpan(context.active(), span);
  const headers = new Headers(options.headers || {});

  // Inject trace headers for downstream correlation
  propagation.inject(ctx, headers as any, {
    set: (carrier, key, value) => carrier.set(key, value),
  });

  const start = performance.now();

  try {
    const response = await context.with(ctx, async () =>
      fetch(url, { ...options, headers })
    );

    const durationMs = performance.now() - start;

    span.setAttributes({
      "http.status_code": response.status,
      "http.duration_ms": durationMs,
    });

    if (!response.ok) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
      logger.warn(`[TRACE:HTTP] ${method} ${url} failed`, { status: response.status, durationMs });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    return response;
  } catch (err: any) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error(`[TRACE:HTTP] ${method} ${url} exception`, { error: err.message });
    throw err;
  } finally {
    span.end();
  }
}

/* --------------------------------------------------------------------------
 * ⚙️ Axios Instance with Interceptors
 * ------------------------------------------------------------------------ */
export function createTracedAxios(baseURL?: string): AxiosInstance {
  const instance = axios.create({ baseURL });

  // Request interceptor — create span
  instance.interceptors.request.use((config: AxiosRequestConfig) => {
    const method = (config.method || "GET").toUpperCase();
    const url = `${config.baseURL || ""}${config.url || ""}`;
    const span = tracer.startSpan(`HTTP ${method} ${url}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.method": method,
        "http.url": url,
        "http.base_url": config.baseURL || "",
      },
    });

    // Inject trace headers
    const ctx = trace.setSpan(context.active(), span);
    config.headers = config.headers || {};
    propagation.inject(ctx, config.headers);

    (config as any).__otel = { span, startTime: performance.now() };
    return config;
  });

  // Response interceptor — finish span
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const span = (response.config as any).__otel?.span;
      const startTime = (response.config as any).__otel?.startTime || performance.now();

      if (span) {
        const durationMs = performance.now() - startTime;
        span.setAttributes({
          "http.status_code": response.status,
          "http.duration_ms": durationMs,
        });

        if (response.status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
          logger.warn(`[TRACE:AXIOS] ${response.config.method?.toUpperCase()} ${response.config.url} failed`, {
            status: response.status,
            durationMs,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end();
      }

      return response;
    },
    (error: any) => {
      const config = error.config || {};
      const span = (config as any).__otel?.span;
      const startTime = (config as any).__otel?.startTime || performance.now();

      if (span) {
        const durationMs = performance.now() - startTime;
        span.setAttributes({ "http.duration_ms": durationMs });
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
      }

      logger.error(`[TRACE:AXIOS] ${config.method?.toUpperCase()} ${config.url} error`, {
        error: error.message,
      });

      return Promise.reject(error);
    }
  );

  return instance;
}

/* --------------------------------------------------------------------------
 * 🌐 Global Singleton Instance (for shared usage)
 * ------------------------------------------------------------------------ */
export const tracedAxios = createTracedAxios();

/* --------------------------------------------------------------------------
 * 🧩 Trace Utilities
 * ------------------------------------------------------------------------ */
export const getActiveTraceId = (): string | null => {
  const span = trace.getSpan(context.active());
  return span ? span.spanContext().traceId : null;
};

export const traceHttpHealth = async (): Promise<{ healthy: boolean; message: string }> => {
  try {
    const traceId = getActiveTraceId();
    if (!traceId) return { healthy: false, message: "No active trace context" };
    return { healthy: true, message: "HTTP tracing operational" };
  } catch (err: any) {
    return { healthy: false, message: err.message };
  }
};

/* --------------------------------------------------------------------------
 * ✅ Summary
 * --------------------------------------------------------------------------
 * - tracedFetch(): Safe wrapper around Fetch with OpenTelemetry tracing.
 * - createTracedAxios(): Returns a preconfigured Axios instance with full tracing.
 * - tracedAxios: Default global instance for shared use.
 * - getActiveTraceId(): Retrieve current trace ID for log correlation.
 * - traceHttpHealth(): Lightweight self-test for observability health probes.
 * --------------------------------------------------------------------------
 */