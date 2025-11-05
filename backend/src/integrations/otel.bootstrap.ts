/**
 * src/integrations/otel.bootstrap.ts
 * --------------------------------------------------------------------------
 * 🧭 Enterprise OpenTelemetry Bootstrap
 *
 * Purpose:
 *  - Bootstrap and initialize OpenTelemetry for the backend.
 *  - Connect traces, metrics, and logs across all subsystems.
 *  - Support distributed tracing for API, workers, DB, Redis, and AI subsystems.
 *  - Ensure graceful shutdown and safe fallback if exporters are unreachable.
 *
 * Design Principles:
 *  - Non-blocking initialization (never prevents app start).
 *  - Auto-detects config from observabilityConfig.ts and environment variables.
 *  - Works seamlessly with multi-service architectures (API + workers).
 */

import { diag, DiagConsoleLogger, DiagLogLevel, context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SimpleSpanProcessor, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { config } from "../config";
import { observabilityConfig } from "../config/observabilityConfig";
import { logger } from "../logger";

let tracerProvider: NodeTracerProvider | null = null;
let initialized = false;

/* ------------------------------------------------------------------------
   🔍 Setup Diagnostic Logging (OTel internal)
------------------------------------------------------------------------ */
if (config.NODE_ENV !== "production") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

/* ------------------------------------------------------------------------
   🧱 Resource Metadata
------------------------------------------------------------------------ */
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: observabilityConfig.serviceName,
  [SemanticResourceAttributes.SERVICE_NAMESPACE]: "project-athlete-360",
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.NODE_ENV,
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || "v1",
});

/* ------------------------------------------------------------------------
   🚀 Initialize OTel Tracer Provider
------------------------------------------------------------------------ */
export const initOpenTelemetry = async (): Promise<void> => {
  if (initialized) {
    logger.warn("[OTEL] Already initialized.");
    return;
  }

  try {
    tracerProvider = new NodeTracerProvider({ resource });

    // Exporter
    const exporter = new OTLPTraceExporter({
      url: observabilityConfig.otlpEndpoint,
      headers: observabilityConfig.otlpHeaders
        ? JSON.parse(observabilityConfig.otlpHeaders)
        : undefined,
    });

    // Use Batch processor for production; Simple for local debugging
    const processor =
      config.NODE_ENV === "production"
        ? new BatchSpanProcessor(exporter, {
            maxExportBatchSize: 512,
            scheduledDelayMillis: 5000,
          })
        : new SimpleSpanProcessor(exporter);

    tracerProvider.addSpanProcessor(processor);

    // Register provider globally
    tracerProvider.register();

    // Register instrumentations (auto-tracing)
    registerInstrumentations({
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        new PrismaInstrumentation(),
        new RedisInstrumentation(),
        new PgInstrumentation(),
      ],
    });

    initialized = true;
    logger.info(`[OTEL] ✅ Tracing initialized for ${observabilityConfig.serviceName}`);
  } catch (err: any) {
    logger.error("[OTEL] ❌ Failed to initialize tracing", { error: err.message });
  }
};

/* ------------------------------------------------------------------------
   🔁 Graceful Shutdown
------------------------------------------------------------------------ */
export const shutdownOpenTelemetry = async (): Promise<void> => {
  if (!tracerProvider) return;
  try {
    await tracerProvider.shutdown();
    logger.info("[OTEL] 🧹 Tracer provider shut down gracefully.");
  } catch (err: any) {
    logger.error("[OTEL] ⚠️ Error during tracer shutdown", { error: err.message });
  }
};

/* ------------------------------------------------------------------------
   🧩 Utility: Trace a function or async task
------------------------------------------------------------------------ */
export const traceAsync = async <T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> => {
  const tracer = trace.getTracer(observabilityConfig.serviceName);
  const span = tracer.startSpan(spanName, { attributes });

  try {
    const ctx = trace.setSpan(context.active(), span);
    const result = await context.with(ctx, fn);
    span.setStatus({ code: 1, message: "OK" });
    return result;
  } catch (err: any) {
    span.setStatus({ code: 2, message: err.message });
    logger.error(`[OTEL] Error in traced span ${spanName}`, { error: err.message });
    throw err;
  } finally {
    span.end();
  }
};

/* ------------------------------------------------------------------------
   🧩 Utility: Run sync function with tracing
------------------------------------------------------------------------ */
export const traceSync = <T>(spanName: string, fn: () => T, attributes?: Record<string, any>): T => {
  const tracer = trace.getTracer(observabilityConfig.serviceName);
  const span = tracer.startSpan(spanName, { attributes });

  try {
    const result = fn();
    span.setStatus({ code: 1, message: "OK" });
    return result;
  } catch (err: any) {
    span.setStatus({ code: 2, message: err.message });
    logger.error(`[OTEL] Error in traced span ${spanName}`, { error: err.message });
    throw err;
  } finally {
    span.end();
  }
};

/* ------------------------------------------------------------------------
   🧩 Quick Health Probe (for systemHealth.service.ts)
------------------------------------------------------------------------ */
export const otelHealthCheck = async (): Promise<{ healthy: boolean; message: string }> => {
  try {
    if (!initialized) return { healthy: false, message: "OTel not initialized" };

    const tracer = trace.getTracer(observabilityConfig.serviceName);
    if (!tracer) return { healthy: false, message: "Tracer unavailable" };

    return { healthy: true, message: "OTel operational" };
  } catch (err: any) {
    return { healthy: false, message: err.message };
  }
};

/* ------------------------------------------------------------------------
   🧱 Automatic Startup / Shutdown Hooks
------------------------------------------------------------------------ */
process.on("SIGTERM", async () => {
  await shutdownOpenTelemetry();
});

process.on("SIGINT", async () => {
  await shutdownOpenTelemetry();
});

/* ------------------------------------------------------------------------
   📦 Export
------------------------------------------------------------------------ */
export default {
  initOpenTelemetry,
  shutdownOpenTelemetry,
  traceAsync,
  traceSync,
  otelHealthCheck,
};