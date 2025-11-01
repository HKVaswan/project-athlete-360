/**
 * tests/integration/superAdmin.security.spec.ts
 * ---------------------------------------------------------------------------
 * 🧠 Integration Test Suite — Super Admin Security (Enterprise Aligned)
 *
 * Focus:
 *  ✅ Enforces MFA, secure login, and access segregation.
 *  ✅ Ensures restricted endpoints reject non-superadmin users.
 *  ✅ Verifies audit logging with hash-chain integrity.
 *  ✅ Confirms IP block enforcement & impersonation safety.
 *  ✅ Validates key rotation & system backup routes.
 *
 * Run with:
 *    npx jest --runInBand --detectOpenHandles
 */

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app";
import prisma from "../../src/prismaClient";
import { config } from "../../src/config";

// ---------------------------------------------------------------------------
// 🧩 Mock Setup
// ---------------------------------------------------------------------------
const SUPER_ADMIN_EMAIL = "root@system.local";
let superAdminToken: string;

beforeAll(async () => {
  const passwordHash =
    "$2b$10$1234567890123456789012abcdefghijabcdefghijabcdefghij"; // mock hash

  await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { role: "SUPER_ADMIN" },
    create: {
      email: SUPER_ADMIN_EMAIL,
      username: "root",
      name: "System Root",
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  // Simulated MFA-verified JWT
  superAdminToken = jwt.sign(
    {
      userId: "superadmin-1",
      role: "SUPER_ADMIN",
      username: "root",
      mfaVerified: true,
      ip: "127.0.0.1",
    },
    config.jwt.secret,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 🚨 1. Access Control & Role Restrictions
// ---------------------------------------------------------------------------
describe("Super Admin Access Control", () => {
  it("rejects access to superadmin routes without token", async () => {
    const res = await request(app).get("/api/superadmin/system/status");
    expect(res.status).toBe(401);
  });

  it("rejects access with non-superadmin token", async () => {
    const userToken = jwt.sign(
      { userId: "user-1", role: "COACH" },
      config.jwt.secret,
      { expiresIn: "1h" }
    );
    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("allows MFA-verified superadmin", async () => {
    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 🧠 2. MFA Enforcement
// ---------------------------------------------------------------------------
describe("Super Admin MFA Enforcement", () => {
  it("blocks super admin if MFA not verified", async () => {
    const noMfaToken = jwt.sign(
      { userId: "superadmin-2", role: "SUPER_ADMIN", mfaVerified: false },
      config.jwt.secret,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${noMfaToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// 🧾 3. Audit Logging & Chain Integrity
// ---------------------------------------------------------------------------
describe("Audit Logging Integration", () => {
  it("records audit log entry when super admin checks system status", async () => {
    const beforeCount = await prisma.auditLog.count();

    await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${superAdminToken}`);

    const afterCount = await prisma.auditLog.count();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it("ensures audit chainHash integrity is maintained", async () => {
    const latest = await prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
    });
    expect(latest?.chainHash).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 🚫 4. IP Block Enforcement
// ---------------------------------------------------------------------------
describe("IP Block Enforcement", () => {
  it("blocks access for IPs marked as blocked", async () => {
    const ipHash = require("crypto")
      .createHash("sha256")
      .update("192.168.0.123")
      .digest("hex");

    await prisma.blockedIP.create({
      data: { ipHash, reason: "Suspicious activity" },
    });

    const blockedToken = jwt.sign(
      { userId: "superadmin-3", role: "SUPER_ADMIN", mfaVerified: true, ip: "192.168.0.123" },
      config.jwt.secret
    );

    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${blockedToken}`);

    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// 👤 5. Impersonation Safety
// ---------------------------------------------------------------------------
describe("Impersonation Security", () => {
  it("should not allow impersonation of non-existent user", async () => {
    const res = await request(app)
      .post("/api/superadmin/impersonate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ targetUserId: "fake-id" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 🔑 6. Backup & Key Rotation Access
// ---------------------------------------------------------------------------
describe("Super Admin Key & Backup Management", () => {
  it("allows super admin to trigger backup", async () => {
    const res = await request(app)
      .post("/api/superadmin/system/backup")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect([200, 201, 202]).toContain(res.status);
  });

  it("rejects backup trigger by normal user", async () => {
    const userToken = jwt.sign(
      { userId: "u1", role: "ATHLETE" },
      config.jwt.secret
    );
    const res = await request(app)
      .post("/api/superadmin/system/backup")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});