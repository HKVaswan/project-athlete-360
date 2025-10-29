/**
 * auth.repo.ts
 * ---------------------------------------------------------------------
 * Data access layer for authentication and token persistence.
 *
 * Responsibilities:
 *  - Find users by email or ID
 *  - Create and update refresh tokens securely
 *  - Manage token revocation and invalidation
 *  - Log and track login sessions (optional)
 */

import { Prisma, User, RefreshToken } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { hashToken } from "../utils/crypto";

export class AuthRepository {
  /**
   * Find a user by email — used during login.
   */
  async findUserByEmail(email: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({ where: { email } });
    } catch (err) {
      throw Errors.Server("Failed to fetch user by email.");
    }
  }

  /**
   * Find a user by ID.
   */
  async findUserById(id: string): Promise<User | null> {
    try {
      return await prisma.user.findUnique({ where: { id } });
    } catch (err) {
      throw Errors.Server("Failed to fetch user by ID.");
    }
  }

  /**
   * Create or update a refresh token record for the user.
   * Each user can have one active refresh token per device.
   */
  async saveRefreshToken(
    userId: string,
    token: string,
    deviceInfo: string | null = null
  ): Promise<RefreshToken> {
    try {
      const hashed = await hashToken(token);
      return await prisma.refreshToken.upsert({
        where: { userId },
        update: { tokenHash: hashed, deviceInfo },
        create: { userId, tokenHash: hashed, deviceInfo },
      });
    } catch (err) {
      throw Errors.Server("Failed to save refresh token.");
    }
  }

  /**
   * Verify if a refresh token is valid and not revoked.
   */
  async verifyRefreshToken(userId: string, token: string): Promise<boolean> {
    try {
      const record = await prisma.refreshToken.findUnique({ where: { userId } });
      if (!record) return false;

      const hashed = await hashToken(token);
      return record.tokenHash === hashed && !record.revoked;
    } catch (err) {
      throw Errors.Server("Failed to verify refresh token.");
    }
  }

  /**
   * Revoke a user's refresh token (logout or security incident).
   */
  async revokeRefreshToken(userId: string): Promise<boolean> {
    try {
      await prisma.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });
      return true;
    } catch (err) {
      throw Errors.Server("Failed to revoke refresh token.");
    }
  }

  /**
   * Track a user login session (optional but useful for analytics).
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
      // do not throw, analytics is non-critical
      console.warn("⚠️ Failed to log login session:", err);
    }
  }

  /**
   * Delete all expired or revoked tokens (cleanup job).
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
      return result.count;
    } catch (err) {
      throw Errors.Server("Failed to cleanup expired tokens.");
    }
  }
}

export const authRepository = new AuthRepository();