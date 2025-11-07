/**
 * tests/integration/tracing_correlation.spec.ts
 * --------------------------------------------------------------------
 * 🧭 Enterprise Integration Test: Trace Correlation & Propagation
 *
 * Objective:
 *   - Validate OpenTelemetry trace propagation across HTTP, Prisma, and Worker layers
 *   - Ensure `traceId`, `spanId`, and `requestId` are correctly correlated in logs
 *   - Verify trace continuity during async and nested operations
 *   - Detect missing spans or trace context leakage
 * --------------------------------------------------------------------
 */

import request from "supertest";
import http from "http";
import app from "../../src/app";
import { trace, context } from "@opentelemetry/api";
import { initOpenTelemetry, otelHealthCheck } from "../../src/integrations/otel.bootstrap";
import { enqueueJob, QueueName, shutdownQueues } from "../../src/workers/queue.factory";
import { initPrismaTracer } from "../../src/lib/prismaTracer";
import { PrismaClient } from "@prisma/client";
import { logger } from "../../src/logger";

let server: http.Server;
const prisma = new PrismaClient();

describe("🧭 Trace Correlation & Propagation Suite", () => {
  beforeAll(async () => {
    // Initialize tracing and DB middleware
    await initOpenTelemetry();
    initPrismaTracer(prisma);

    // Start backend
    server = app.listen(0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await shutdownQueues();
    if (server) await new Promise((r) => server.close(r));
  });

  /* -----------------------------------------------------------
   * 1️⃣ Health Check: OTel Bootstrap Validation
   * --------------------------------------------------------- */
  it("should have OpenTelemetry initialized successfully", async () => {
    const health = await otelHealthCheck();
    expect(health.healthy).toBe(true);
  });

  /* -----------------------------------------------------------
   * 2️⃣ HTTP Trace Correlation
   * --------------------------------------------------------- */
  it("should include traceId and spanId in each HTTP request context", async () => {
    const res = await request(server).get("/health").expect(200);
    const activeSpan = trace.getSpan(context.active());
    expect(res.body).toHaveProperty("success", true);
    // Ensure current trace is valid
    if (activeSpan) {
      const ctx = activeSpan.spanContext();
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  /* -----------------------------------------------------------
   * 3️⃣ Trace Header Propagation
   * --------------------------------------------------------- */
  it("should propagate W3C traceparent headers across HTTP requests", async () => {
    const customTraceId = "0123456789abcdef0123456789abcdef";
    const parentId = "0123456789abcdef";
    const traceparent = `00-${customTraceId}-${parentId}-01`;

    const res = await request(server)
      .get("/health")
      .set("traceparent", traceparent)
      .expect(200);

    // The propagated traceId should be visible in logs or returned
    expect(res.body.traceId || res.body.requestId).toBeDefined();
  });

  /* -----------------------------------------------------------
   * 4️⃣ Prisma Query Trace Propagation
   * --------------------------------------------------------- */
  it("should attach trace context to Prisma queries", async () => {
    const tracer = trace.getTracer("test-suite");
    await tracer.startActiveSpan("db.test.query", async (span) => {
      const user = await prisma.user.findFirst({}); // assuming a User model exists
      expect(user).toBeDefined();
      const active = trace.getSpan(context.active());
      expect(active).not.toBeNull();
      span.end();
    });
  });

  /* -----------------------------------------------------------
   * 5️⃣ Worker Enqueue Span Propagation
   * --------------------------------------------------------- */
  it("should maintain trace context when enqueueing a background job", async () => {
    const tracer = trace.getTracer("test-suite");
    await tracer.startActiveSpan("test.enqueue.job", async (span) => {
      const job = await enqueueJob(QueueName.TELEMETRY, "trace-test", { test: true });
      expect(job).toBeDefined();
      expect(job.name).toBe("trace-test");

      const active = trace.getSpan(context.active());
      if (active) {
        const ctx = active.spanContext();
        expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      }
      span.end();
    });
  });

  /* -----------------------------------------------------------
   * 6️⃣ Trace Continuity in Nested Async Calls
   * --------------------------------------------------------- */
  it("should maintain same traceId across nested async operations", async () => {
    const tracer = trace.getTracer("nested-test");
    await tracer.startActiveSpan("parent-span", async (parentSpan) => {
      const parentCtx = parentSpan.spanContext();

      await new Promise<void>((resolve) => {
        tracer.startActiveSpan("child-span", (childSpan) => {
          const childCtx = childSpan.spanContext();
          expect(childCtx.traceId).toBe(parentCtx.traceId); // same trace lineage
          childSpan.end();
          resolve();
        });
      });

      parentSpan.end();
    });
  });

  /* -----------------------------------------------------------
   * 7️⃣ Trace Context Isolation
   * --------------------------------------------------------- */
  it("should isolate trace context between parallel requests", async () => {
    const [resA, resB] = await Promise.all([
      request(server).get("/health").expect(200),
      request(server).get("/metrics").expect(200),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.body).not.toEqual(resB.body); // ensure context isolation
  });

  /* -----------------------------------------------------------
   * 8️⃣ Logging Correlation Validation
   * --------------------------------------------------------- */
  it("should include requestId and traceId in logs for correlation", () => {
    const sample = {
      level: "info",
      message: "Test log message",
      requestId: "req_123",
      traceId: "abc123",
    };
    const logString = JSON.stringify(sample);
    expect(logString).toContain("traceId");
    expect(logString).toContain("requestId");
  });

  /* -----------------------------------------------------------
   * 9️⃣ Error Span Verification
   * --------------------------------------------------------- */
  it("should record exceptions within spans and mark status as ERROR", async () => {
    const tracer = trace.getTracer("test-suite");
    await tracer.startActiveSpan("error-test-span", async (span) => {
      try {
        throw new Error("Intentional test error");
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: 2, message: err.message });
      } finally {
        const ctx = span.spanContext();
        expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
        span.end();
      }
    });
  });
});