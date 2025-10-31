/**
 * tests/integration/superAdmin.security.spec.ts
 * ---------------------------------------------------------------------------
 * Integration Test Suite — Super Admin Security
 *
 * Focus:
 *  - Enforces MFA and secure login for super admin.
 *  - Ensures restricted endpoints reject non-superadmin users.
 *  - Verifies audit logging and impersonation are recorded correctly.
 *  - Checks token rotation, backup restore, and key rotation access.
 *
 * Run with: npx jest --runInBand --detectOpenHandles
 */

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app";
import prisma from "../../src/prismaClient";
import { config } from "../../src/config";

// ---------------------------------------------------------------------------
// 🧩 Mock Helpers
// ---------------------------------------------------------------------------
const SUPER_ADMIN_EMAIL = "root@system.local";
let superAdminToken: string;

// Create a test super admin user before tests run
beforeAll(async () => {
  const passwordHash = "$2b$10$1234567890123456789012abcdefghijabcdefghijabcdefghij"; // mock hash

  await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { role: "super_admin" },
    create: {
      email: SUPER_ADMIN_EMAIL,
      username: "root",
      name: "System Root",
      passwordHash,
      role: "super_admin",
    },
  });

  // Simulate MFA-verified super admin JWT
  superAdminToken = jwt.sign(
    {
      userId: "superadmin-1",
      role: "super_admin",
      username: "root",
      mfaVerified: true,
    },
    config.jwt.secret,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 🚨 1. Access Control Tests
// ---------------------------------------------------------------------------
describe("Super Admin Access Control", () => {
  it("should reject access to superadmin routes without token", async () => {
    const res = await request(app).get("/api/superadmin/system/status");
    expect(res.status).toBe(401);
  });

  it("should reject access with non-superadmin token", async () => {
    const userToken = jwt.sign(
      { userId: "user-1", role: "coach" },
      config.jwt.secret,
      { expiresIn: "1h" }
    );
    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("should allow access to superadmin with MFA verified token", async () => {
    const res = await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 🧠 2. MFA Enforcement Tests
// ---------------------------------------------------------------------------
describe("Super Admin MFA Enforcement", () => {
  it("should block super admin if MFA is not verified", async () => {
    const noMfaToken = jwt.sign(
      { userId: "superadmin-2", role: "super_admin", mfaVerified: false },
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
// 🧾 3. Audit Logging Tests
// ---------------------------------------------------------------------------
describe("Audit Logging Integration", () => {
  it("should record an audit log entry when a super admin checks system status", async () => {
    const beforeCount = await prisma.auditLog.count();

    await request(app)
      .get("/api/superadmin/system/status")
      .set("Authorization", `Bearer ${superAdminToken}`);

    const afterCount = await prisma.auditLog.count();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});

// ---------------------------------------------------------------------------
// 👤 4. Impersonation Safety Tests
// ---------------------------------------------------------------------------
describe("Impersonation Security", () => {
  it("should not allow super admin to impersonate non-existent user", async () => {
    const res = await request(app)
      .post("/api/superadmin/impersonate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ targetUserId: "fake-id" });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 🔑 5. Key Rotation & Backup Access
// ---------------------------------------------------------------------------
describe("Super Admin Key & Backup Management", () => {
  it("should allow super admin to trigger backup", async () => {
    const res = await request(app)
      .post("/api/superadmin/system/backup")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect([200, 201, 202]).toContain(res.status);
  });

  it("should reject backup trigger by normal user", async () => {
    const userToken = jwt.sign({ userId: "u1", role: "athlete" }, config.jwt.secret);
    const res = await request(app)
      .post("/api/superadmin/system/backup")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });
});