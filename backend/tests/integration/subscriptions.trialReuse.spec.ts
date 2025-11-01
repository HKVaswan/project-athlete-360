/**
 * tests/integration/subscriptions.trialReuse.spec.ts
 * ------------------------------------------------------------------------
 * Integration Test — Trial Reuse Prevention & Subscription Enforcement
 *
 * Ensures:
 *  - A user/device/IP cannot claim multiple free trials.
 *  - Reuse detection via hashed fingerprint triggers a Forbidden error.
 *  - Normal paid subscriptions are not blocked.
 *  - Logs and audit entries are generated properly.
 * ------------------------------------------------------------------------
 */

import request from "supertest";
import app from "../../src/app";
import prisma from "../../src/prismaClient";
import { config } from "../../src/config";
import { hash } from "crypto";

// Utility: hash for test parity with backend
const genHash = (val: string) => hash("sha256").update(val).digest("hex");

// Mock device fingerprint headers
const mockHeaders = {
  "x-device-id": "mock-device-12345",
  "user-agent": "Mozilla/5.0 (TrialTestBot)",
  "x-forwarded-for": "192.168.1.50",
};

describe("🧩 Trial Reuse Prevention (Integration Test)", () => {
  beforeAll(async () => {
    await prisma.trialAbuseLog.deleteMany();
    await prisma.user.deleteMany();
    await prisma.institution.deleteMany();
    await prisma.subscription.deleteMany();

    // Create a mock institution
    await prisma.institution.create({
      data: {
        id: "inst-trial-1",
        name: "Trial Institution",
        code: "TRIALINST1",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------
  // 1️⃣  First Trial Registration (should succeed)
  // ------------------------------------------------------------------------
  it("should allow a new user to start a free trial once", async () => {
    const res = await request(app)
      .post("/api/subscriptions/start-trial")
      .set(mockHeaders)
      .send({
        email: "trialuser1@example.com",
        institutionId: "inst-trial-1",
        planId: "basic-plan-id",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("TRIALING");

    const logCount = await prisma.trialAbuseLog.count({
      where: { hashedIp: genHash("192.168.1.50") },
    });
    expect(logCount).toBe(1);
  });

  // ------------------------------------------------------------------------
  // 2️⃣  Second Trial Attempt from same device/IP/email → Blocked
  // ------------------------------------------------------------------------
  it("should block second free trial from same IP/device/email", async () => {
    const res = await request(app)
      .post("/api/subscriptions/start-trial")
      .set(mockHeaders)
      .send({
        email: "trialuser2@example.com",
        institutionId: "inst-trial-1",
        planId: "basic-plan-id",
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Free trial already used/);

    const logs = await prisma.trialAbuseLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------------
  // 3️⃣  Trial from a different IP/device should pass
  // ------------------------------------------------------------------------
  it("should allow trial from a different IP/device combo", async () => {
    const res = await request(app)
      .post("/api/subscriptions/start-trial")
      .set({
        "x-device-id": "mock-device-999",
        "x-forwarded-for": "10.0.0.9",
        "user-agent": "Mozilla/5.0 (TrialTestBot)",
      })
      .send({
        email: "trialuser3@example.com",
        institutionId: "inst-trial-1",
        planId: "basic-plan-id",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // ------------------------------------------------------------------------
  // 4️⃣  Paid subscription should not be blocked even if same fingerprint
  // ------------------------------------------------------------------------
  it("should allow a paid plan even if fingerprint previously used for trial", async () => {
    const res = await request(app)
      .post("/api/subscriptions/start-paid")
      .set(mockHeaders)
      .send({
        email: "trialuser4@example.com",
        institutionId: "inst-trial-1",
        planId: "premium-plan-id",
        paymentIntentId: "pay_123_test",
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ACTIVE");
  });

  // ------------------------------------------------------------------------
  // 5️⃣  Verify Audit Log Created
  // ------------------------------------------------------------------------
  it("should create an audit log entry on trial abuse detection", async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "TRIAL_ABUSE_DETECTED" },
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].details).toHaveProperty("ip");
  });
});