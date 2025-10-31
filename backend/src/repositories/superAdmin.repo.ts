/**
 * src/repositories/superAdmin.repo.ts
 * --------------------------------------------------------------------------
 * 🛡️ Super Admin Repository (Enterprise-Grade)
 *
 * Central data access layer for Super Admin operations:
 *  - Manage super admin accounts and permissions
 *  - Control system-level configurations and policies
 *  - Approve or demote admins
 *  - Log all critical actions for audit trails
 *  - Built-in MFA & integrity checks
 */

import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { config } from "../config";

export interface CreateSuperAdminInput {
  username: string;
  email: string;
  password: string;
  name?: string;
  mfaSecret?: string;
  createdBy?: string;
}

export interface SystemConfigUpdate {
  key: string;
  value: string | boolean | number | object;
  updatedBy: string;
}

class SuperAdminRepository {
  /* ------------------------------------------------------------------------
     🧩 1. Create Super Admin Account (Bootstrapping)
  ------------------------------------------------------------------------ */
  async createSuperAdmin(input: CreateSuperAdminInput) {
    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email: input.email }, { username: input.username }] },
      });
      if (existing) throw Errors.Duplicate("Super Admin already exists with these credentials.");

      const passwordHash = await bcrypt.hash(input.password, 12);

      const user = await prisma.user.create({
        data: {
          username: input.username,
          email: input.email,
          name: input.name || "System Admin",
          passwordHash,
          role: "super_admin",
          mfaSecret: input.mfaSecret || null,
          createdBy: input.createdBy || "system",
        },
      });

      logger.info(`[SUPERADMIN_REPO] ✅ Super Admin created: ${user.username}`);
      return user;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] ❌ Failed to create Super Admin: ${err.message}`);
      throw Errors.Server("Failed to create Super Admin");
    }
  }

  /* ------------------------------------------------------------------------
     🔐 2. Verify Super Admin Credentials
  ------------------------------------------------------------------------ */
  async verifyCredentials(emailOrUsername: string, password: string) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          role: "super_admin",
          OR: [{ email: emailOrUsername }, { username: emailOrUsername }],
        },
      });

      if (!user) throw Errors.Auth("Invalid credentials");

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw Errors.Auth("Invalid credentials");

      return user;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Auth failed: ${err.message}`);
      throw Errors.Auth("Super Admin login failed");
    }
  }

  /* ------------------------------------------------------------------------
     🔑 3. Update MFA Secret / Enable MFA
  ------------------------------------------------------------------------ */
  async updateMFA(userId: string, secret: string) {
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { mfaSecret: secret },
      });
      logger.info(`[SUPERADMIN_REPO] 🔐 MFA updated for Super Admin ${userId}`);
      return updated;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to update MFA: ${err.message}`);
      throw Errors.Server("Failed to update MFA settings");
    }
  }

  /* ------------------------------------------------------------------------
     🧮 4. Manage Admin Approvals / Demotions
  ------------------------------------------------------------------------ */
  async approveAdmin(adminId: string, approvedBy: string) {
    try {
      const admin = await prisma.user.findUnique({ where: { id: adminId } });
      if (!admin || admin.role !== "admin")
        throw Errors.NotFound("Admin account not found or invalid role");

      const updated = await prisma.user.update({
        where: { id: adminId },
        data: { approved: true },
      });

      await prisma.adminAudit.create({
        data: {
          adminId,
          approvedBy,
          action: "ADMIN_APPROVAL",
          timestamp: new Date(),
        },
      });

      logger.info(`[SUPERADMIN_REPO] ✅ Admin ${admin.username} approved by ${approvedBy}`);
      return updated;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to approve admin: ${err.message}`);
      throw Errors.Server("Failed to approve admin");
    }
  }

  async demoteAdmin(adminId: string, demotedBy: string, reason?: string) {
    try {
      const admin = await prisma.user.findUnique({ where: { id: adminId } });
      if (!admin || admin.role !== "admin")
        throw Errors.NotFound("Admin account not found or invalid role");

      const updated = await prisma.user.update({
        where: { id: adminId },
        data: { role: "coach" },
      });

      await prisma.adminAudit.create({
        data: {
          adminId,
          approvedBy: demotedBy,
          action: "ADMIN_DEMOTION",
          details: { reason },
          timestamp: new Date(),
        },
      });

      logger.warn(`[SUPERADMIN_REPO] ⚠️ Admin ${admin.username} demoted by ${demotedBy}`);
      return updated;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to demote admin: ${err.message}`);
      throw Errors.Server("Failed to demote admin");
    }
  }

  /* ------------------------------------------------------------------------
     ⚙️ 5. Manage System Configuration / Settings
  ------------------------------------------------------------------------ */
  async updateSystemConfig({ key, value, updatedBy }: SystemConfigUpdate) {
    try {
      const existing = await prisma.systemConfig.findUnique({ where: { key } });

      if (existing) {
        const updated = await prisma.systemConfig.update({
          where: { key },
          data: { value: JSON.stringify(value), updatedBy },
        });
        return updated;
      }

      const created = await prisma.systemConfig.create({
        data: { key, value: JSON.stringify(value), updatedBy },
      });
      return created;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to update config: ${err.message}`);
      throw Errors.Server("Failed to update system configuration");
    }
  }

  async getSystemConfig(key: string) {
    try {
      const configItem = await prisma.systemConfig.findUnique({ where: { key } });
      return configItem ? JSON.parse(configItem.value as string) : null;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to fetch config: ${err.message}`);
      throw Errors.Server("Failed to fetch system configuration");
    }
  }

  /* ------------------------------------------------------------------------
     🧠 6. View / Manage System Logs Summary
  ------------------------------------------------------------------------ */
  async getSystemAuditSummary(limit = 20) {
    try {
      return await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          action: true,
          entity: true,
          timestamp: true,
        },
      });
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to fetch audit summary: ${err.message}`);
      throw Errors.Server("Failed to fetch audit summary");
    }
  }

  /* ------------------------------------------------------------------------
     🚨 7. Rotate Secrets / Integrity Tokens
  ------------------------------------------------------------------------ */
  async rotateSystemSecret(type: "jwt" | "refresh" | "hmac" | "encryption", rotatedBy: string) {
    try {
      const newSecret = crypto.randomBytes(48).toString("hex");

      await prisma.systemSecrets.upsert({
        where: { type },
        update: { value: newSecret, rotatedBy, rotatedAt: new Date() },
        create: { type, value: newSecret, rotatedBy },
      });

      logger.info(`[SUPERADMIN_REPO] 🔁 ${type.toUpperCase()} secret rotated by ${rotatedBy}`);
      return newSecret;
    } catch (err: any) {
      logger.error(`[SUPERADMIN_REPO] Failed to rotate secret: ${err.message}`);
      throw Errors.Server("Failed to rotate system secret");
    }
  }
}

export const superAdminRepository = new SuperAdminRepository();