/**
 * src/services/impersonation.service.ts
 * ----------------------------------------------------------------------
 * Super Admin Impersonation Service (Enterprise-Grade)
 *
 * Purpose:
 *  - Allow Super Admins to securely impersonate other users for support,
 *    debugging, or moderation purposes.
 *  - Full audit trail for every impersonation session.
 *  - Enforces MFA and cryptographically signed tokens.
 *  - Includes automatic expiry, revocation, and session validation.
 * ----------------------------------------------------------------------
 */

import jwt from "jsonwebtoken";
import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "./audit.service";
import { config } from "../config";
import crypto from "crypto";
import { Errors } from "../utils/errors";

const IMPERSONATION_TOKEN_TTL = 15 * 60; // 15 minutes
const IMPERSONATION_SECRET = process.env.IMPERSONATION_SECRET || config.jwt.secret;

/* -----------------------------------------------------------------------
   🧩 Types
------------------------------------------------------------------------*/
export interface ImpersonationPayload {
  superAdminId: string;
  targetUserId: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

/* -----------------------------------------------------------------------
   🧠 Core Impersonation Service
------------------------------------------------------------------------*/
class ImpersonationService {
  /**
   * Verify super admin and target, then generate a temporary impersonation token.
   */
  async createImpersonationToken(
    superAdminId: string,
    targetUserId: string
  ): Promise<string> {
    try {
      const superAdmin = await prisma.user.findUnique({
        where: { id: superAdminId },
        select: { id: true, role: true, mfaVerified: true, username: true },
      });

      if (!superAdmin || superAdmin.role !== "super_admin") {
        throw Errors.Forbidden("Only Super Admins can initiate impersonation.");
      }
      if (!superAdmin.mfaVerified) {
        throw Errors.Forbidden("MFA verification required before impersonation.");
      }

      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, username: true, role: true },
      });
      if (!targetUser) throw Errors.NotFound("Target user not found.");

      if (targetUser.role === "super_admin") {
        throw Errors.Forbidden("Cannot impersonate another Super Admin.");
      }

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + IMPERSONATION_TOKEN_TTL * 1000);
      const baseString = `${superAdminId}:${targetUserId}:${issuedAt.toISOString()}`;
      const signature = crypto.createHmac("sha256", IMPERSONATION_SECRET).update(baseString).digest("hex");

      const payload: ImpersonationPayload = {
        superAdminId,
        targetUserId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        signature,
      };

      // Sign JWT impersonation token
      const token = jwt.sign(payload, IMPERSONATION_SECRET, {
        expiresIn: IMPERSONATION_TOKEN_TTL,
      });

      await prisma.impersonationSession.create({
        data: {
          superAdminId,
          targetUserId,
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          expiresAt,
          active: true,
        },
      });

      await auditService.log({
        actorId: superAdminId,
        actorRole: "super_admin",
        action: "IMPERSONATION_REQUEST",
        details: { targetUserId, targetRole: targetUser.role },
      });

      logger.info(
        `[IMPERSONATION] Super Admin ${superAdmin.username} impersonating ${targetUser.username} (${targetUser.role})`
      );

      return token;
    } catch (err: any) {
      logger.error(`[IMPERSONATION] ❌ Failed to create token: ${err.message}`);
      throw Errors.Server("Failed to create impersonation token.");
    }
  }

  /**
   * Validate impersonation token integrity and expiration.
   */
  async validateToken(token: string) {
    try {
      const decoded = jwt.verify(token, IMPERSONATION_SECRET) as ImpersonationPayload;

      // Cross-check stored session
      const session = await prisma.impersonationSession.findFirst({
        where: { targetUserId: decoded.targetUserId, active: true },
      });

      if (!session) throw Errors.Auth("Invalid or expired impersonation session.");
      const storedHash = session.tokenHash;
      const providedHash = crypto.createHash("sha256").update(token).digest("hex");
      if (storedHash !== providedHash) throw Errors.Auth("Token mismatch or tampering detected.");

      const now = new Date();
      if (new Date(decoded.expiresAt) < now) {
        await this.revokeSession(decoded.superAdminId, decoded.targetUserId);
        throw Errors.Auth("Impersonation token expired.");
      }

      return decoded;
    } catch (err: any) {
      logger.warn(`[IMPERSONATION] Invalid or expired token: ${err.message}`);
      throw Errors.Auth("Invalid or expired impersonation token.");
    }
  }

  /**
   * Revoke an active impersonation session manually or on expiry.
   */
  async revokeSession(superAdminId: string, targetUserId: string) {
    try {
      await prisma.impersonationSession.updateMany({
        where: { superAdminId, targetUserId, active: true },
        data: { active: false, revokedAt: new Date() },
      });

      await auditService.log({
        actorId: superAdminId,
        actorRole: "super_admin",
        action: "ADMIN_OVERRIDE",
        details: { targetUserId, event: "Impersonation session revoked" },
      });

      logger.info(`[IMPERSONATION] Session revoked for ${targetUserId}`);
    } catch (err: any) {
      logger.error(`[IMPERSONATION] ❌ Failed to revoke session: ${err.message}`);
      throw Errors.Server("Failed to revoke impersonation session.");
    }
  }

  /**
   * List all active impersonation sessions (for monitoring / security dashboard)
   */
  async listActiveSessions() {
    return prisma.impersonationSession.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        superAdminId: true,
        targetUserId: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Force revoke all active impersonations (emergency security control)
   */
  async revokeAll() {
    const result = await prisma.impersonationSession.updateMany({
      where: { active: true },
      data: { active: false, revokedAt: new Date() },
    });

    await auditService.recordSecurityEvent({
      actorRole: "system",
      message: "Emergency impersonation session revocation executed.",
      severity: "high",
    });

    logger.warn(`[IMPERSONATION] ⚠️ Force-revoked ${result.count} active sessions.`);
    return result.count;
  }
}

/* -----------------------------------------------------------------------
   🚀 Export Singleton
------------------------------------------------------------------------*/
export const impersonationService = new ImpersonationService();