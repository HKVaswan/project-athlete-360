/**
 * src/repositories/auth.repo.ts
 * ---------------------------------------------------------------------
 * Enhanced Authentication Repository
 *
 * Responsibilities:
 *  - Secure token persistence (hashed)
 *  - Multi-device refresh management
 *  - Token revocation and audit logging
 *  - Super Admin trace visibility for security events
 *  - Session version and cleanup integration
 */

import { Prisma, User, RefreshToken } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { hashToken } from "../utils/crypto";
import { auditService } from "../lib/audit";
import Analytics from "../lib/analytics";

export class AuthRepository {
  /**
   * 🔍 Find a user by email — used during login.
   */
  async findUserByEmail(email: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({ where: { email } });
    } catch (err) {
      throw Errors.Server("Failed to fetch user by email.");
    }
  }

  /**
   * 🔍 Find a user by ID.
   */
  async findUserById(id: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({ where: { id } });
    } catch (err) {
      throw Errors.Server("Failed to fetch user by ID.");
    }
  }

  /**
   * 💾 Create or update a refresh token (supports per-device).
   * Each device has its own token record, enabling multi-device logins.
   */
  async saveRefreshToken(
    userId: string,
    token: string,
    deviceInfo: string | null = null,
    actorId?: string // super admin performing impersonation
  ): Promise<RefreshToken> {
    try {
      const hashed = await hashToken(token);

      const refresh = await prisma.refreshToken.upsert({
        where: {
          userDevice: { userId, deviceInfo: deviceInfo ?? "default" },
        },
        update: { tokenHash: hashed, revoked: false, updatedAt: new Date() },
        create: { userId, tokenHash: hashed, deviceInfo },
      });

      await auditService.log({
        actorId: actorId || userId,
        actorRole: actorId ? "super_admin" : "user",
        action: "USER_LOGIN",
        entity: "refreshToken",
        entityId: refresh.id,
        details: { deviceInfo },
      });

      Analytics.track({
        event: "login_session_started",
        distinctId: userId,
        properties: { deviceInfo, via: actorId ? "impersonation" : "normal" },
      });

      return refresh;
    } catch (err) {
      throw Errors.Server("Failed to save refresh token.");
    }
  }

  /**
   * ✅ Verify refresh token validity.
   */
  async verifyRefreshToken(userId: string, token: string): Promise<boolean> {
    try {
      const records = await prisma.refreshToken.findMany({ where: { userId, revoked: false } });
      if (!records.length) return false;

      const hashed = await hashToken(token);
      return records.some((r) => r.tokenHash === hashed);
    } catch (err) {
      throw Errors.Server("Failed to verify refresh token.");
    }
  }

  /**
   * 🚫 Revoke all refresh tokens for a user (logout, password reset, or admin action).
   */
  async revokeRefreshTokens(userId: string, revokedBy?: string): Promise<boolean> {
    try {
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });

      await auditService.log({
        actorId: revokedBy || userId,
        actorRole: revokedBy ? "super_admin" : "user",
        action: "SECURITY_EVENT",
        entity: "refreshToken",
        entityId: userId,
        details: { reason: revokedBy ? "admin_revoked" : "user_logout" },
      });

      Analytics.track({
        event: "session_revoked",
        distinctId: userId,
        properties: { revokedBy: revokedBy || "self" },
      });

      return true;
    } catch (err) {
      throw Errors.Server("Failed to revoke refresh tokens.");
    }
  }

  /**
   * 🕒 Track a user login session for telemetry (non-critical).
   */
  async logLoginSession(userId: string, ipAddress?: string, userAgent?: string) {
    try {
      await prisma.loginSession.create({
        data: {
          userId,
          ipAddress,
          userAgent,
          loggedInAt: new Date(),
        },
      });
    } catch (err) {
      console.warn("⚠️ Failed to log login session:", err);
    }
  }

  /**
   * 🧹 Clean up expired or revoked tokens periodically.
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const now = new Date();
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { revoked: true },
            { expiresAt: { lt: now } },
          ],
        },
      });
      if (result.count > 0) {
        await auditService.log({
          actorId: "system",
          actorRole: "system",
          action: "SYSTEM_ALERT",
          details: { cleanupCount: result.count },
        });
      }
      return result.count;
    } catch (err) {
      throw Errors.Server("Failed to cleanup expired tokens.");
    }
  }

  /**
   * 🔄 Increment user's session version (invalidates all previous JWTs)
   */
  async bumpSessionVersion(userId: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "SECURITY_EVENT",
        entity: "user",
        entityId: userId,
        details: { reason: "session_version_bumped" },
      });
    } catch (err) {
      throw Errors.Server("Failed to update session version.");
    }
  }
}

export const authRepository = new AuthRepository();