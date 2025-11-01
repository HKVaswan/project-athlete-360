/**
 * tests/integration/subscriptions.trialReuse.spec.ts
 * --------------------------------------------------------------------------
 * Integration tests for subscription and trial logic.
 *
 * Objectives:
 *  - Prevent trial re-use (via email, IP, or device fingerprint)
 *  - Validate trial expiration → paid plan transition
 *  - Verify correct plan enforcement and audit tracking
 *
 * These tests simulate real-world scenarios (using supertest / Jest).
 * --------------------------------------------------------------------------
 */

import request from "supertest";
import app from "../../src/app";
import prisma from "../../src/prismaClient";
import { config } from "../../src/config";

const testEmail = "trialuser@example.com";
let trialUserToken: string;
let deviceFingerprint = "FAKE-DEVICE-FP-1234";
let testInstitutionId: string;

beforeAll(async () => {
  // Clean up from previous runs
  await prisma.user.deleteMany({ where: { email: testEmail } });

  // Mock institution for linking
  const inst = await prisma.institution.create({
    data: { name: "Trial Institution", code: "INST-9999", adminId: "seed-admin" },
  });
  testInstitutionId = inst.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* -----------------------------------------------------------------------
   🧩 1. Register New Institution Admin (Free Trial)
------------------------------------------------------------------------*/
describe("🧪 Trial registration and trial-reuse prevention", () => {
  it("should allow a new institution admin to start a trial", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        username: "trialadmin1",
        email: testEmail,
        password: "SecurePass123",
        name: "Test Admin",
        role: "admin",
        institutionCode: "INST-9999",
        fingerprint: deviceFingerprint,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.role).toBe("admin");

    trialUserToken = res.body.data.accessToken;

    const sub = await prisma.subscription.findFirst({
      where: { userId: res.body.data.user.id },
    });

    expect(sub?.planId).toBe("free_trial");
    expect(sub?.expiresAt).toBeTruthy();
  });

  /* --------------------------------------------------------------------
     🧱 2. Prevent same device or email from reusing trial
  --------------------------------------------------------------------*/
  it("should block same email from registering another free trial", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        username: "trialadmin2",
        email: testEmail,
        password: "AnotherPass123",
        name: "Cloned Admin",
        role: "admin",
        institutionCode: "INST-9999",
        fingerprint: deviceFingerprint,
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already used.*trial/i);
  });

  it("should block same device fingerprint from reusing trial with different email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        username: "trialadmin3",
        email: "different@example.com",
        password: "DiffPass123",
        name: "Duplicate Device",
        role: "admin",
        institutionCode: "INST-9999",
        fingerprint: deviceFingerprint, // reused fingerprint
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/device.*already.*trial/i);
  });

  /* --------------------------------------------------------------------
     ⏳ 3. Simulate trial expiration → enforce plan limit
  --------------------------------------------------------------------*/
  it("should enforce plan limit after trial expiry", async () => {
    // Simulate expiration
    const sub = await prisma.subscription.findFirst({ where: { userId: { not: null } } });
    if (!sub) throw new Error("Trial subscription not found for test");

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { expiresAt: new Date(Date.now() - 1000 * 60 * 60 * 24) }, // expired yesterday
    });

    // Try using restricted endpoint
    const res = await request(app)
      .post("/api/resources/upload")
      .set("Authorization", `Bearer ${trialUserToken}`)
      .send({ title: "Test Upload After Expiry" });

    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/trial.*expired/i);
  });
});
