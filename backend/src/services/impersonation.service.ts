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
import crypto from "crypto";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "./audit.service";
import { config } from "../config";
import { Errors } from "../utils/errors";

const IMPERSONATION_TOKEN_TTL = Number(process.env.IMPERSONATION_TOKEN_TTL_SEC ?? 15 * 60); // seconds
const IMPERSONATION_SECRET = process.env.IMPERSONATION_SECRET || config.jwt?.secret;
if (!IMPERSONATION_SECRET) {
  logger.warn("[IMPERSONATION] No IMPERSONATION_SECRET configured — tokens will use ephemeral secret.");
}

export interface ImpersonationPayload {
  superAdminId: string;
  targetUserId: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  nonce?: string;
}

class ImpersonationService {
  /**
   * Create a short-lived impersonation JWT after validating the super admin and target user.
   * Stores a hashed token in DB for later validation & revocation.
   */
  async createImpersonationToken(superAdminId: string, targetUserId: string): Promise<string> {
    try {
      // Validate super admin
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

      // Validate target
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, username: true, role: true },
      });

      if (!targetUser) throw Errors.NotFound("Target user not found.");
      if (targetUser.role === "super_admin") {
        throw Errors.Forbidden("Impersonation of other Super Admins is not allowed.");
      }

      // Build payload and cryptographic signature
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + IMPERSONATION_TOKEN_TTL * 1000);
      const nonce = crypto.randomBytes(8).toString("hex");
      const baseString = `${superAdminId}:${targetUserId}:${issuedAt.toISOString()}:${nonce}`;
      const signature = crypto
        .createHmac("sha256", IMPERSONATION_SECRET || "")
        .update(baseString)
        .digest("hex");

      const payload: ImpersonationPayload = {
        superAdminId,
        targetUserId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        signature,
        nonce,
      };

      // Sign JWT
      const token = jwt.sign(payload as any, IMPERSONATION_SECRET || "", {
        expiresIn: IMPERSONATION_TOKEN_TTL,
      });

      // Persist token hash & session record (for revocation / audit)
      await prisma.impersonationSession.create({
        data: {
          superAdminId,
          targetUserId,
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          expiresAt,
          active: true,
          createdAt: new Date(),
        },
      });

      // Audit log
      await auditService.log({
        actorId: superAdminId,
        actorRole: "super_admin",
        action: "IMPERSONATION_REQUEST",
        details: { targetUserId, targetRole: targetUser.role, method: "token" },
      });

      logger.info(
        `[IMPERSONATION] Super Admin ${superAdmin.username} (${superAdmin.id}) created impersonation token for ${targetUser.username} (${targetUser.id}).`
      );

      return token;
    } catch (err: any) {
      logger.error(`[IMPERSONATION] Failed to create token: ${err?.message || err}`);
      // Preserve error surface, but wrap to avoid leaking internals
      if (err?.statusCode) throw err;
      throw Errors.Server("Failed to create impersonation token.");
    }
  }

  /**
   * Validate the provided impersonation token:
   *  - Verify JWT signature & expiry
   *  - Cross-check stored session token hash
   *  - Return decoded payload on success
   */
  async validateToken(token: string): Promise<ImpersonationPayload> {
    try {
      if (!IMPERSONATION_SECRET) throw Errors.Server("Impersonation secret not configured.");

      const decoded = jwt.verify(token, IMPERSONATION_SECRET) as ImpersonationPayload;

      // Validate presence of required fields
      if (!decoded || !decoded.superAdminId || !decoded.targetUserId) {
        throw Errors.Auth("Invalid impersonation token.");
      }

      // Validate stored session exists & token hash matches
      const storedHash = crypto.createHash("sha256").update(token).digest("hex");
      const session = await prisma.impersonationSession.findFirst({
        where: {
          targetUserId: decoded.targetUserId,
          superAdminId: decoded.superAdminId,
          tokenHash: storedHash,
          active: true,
        },
      });

      if (!session) throw Errors.Auth("Invalid or revoked impersonation session.");

      // Check expiry in payload
      const now = new Date();
      if (new Date(decoded.expiresAt) < now) {
        // revoke stale session
        await this.revokeSession(decoded.superAdminId, decoded.targetUserId);
        throw Errors.Auth("Impersonation token expired.");
      }

      return decoded;
    } catch (err: any) {
      logger.warn(`[IMPERSONATION] Token validation failed: ${err?.message || err}`);
      throw Errors.Auth("Invalid or expired impersonation token.");
    }
  }

  /**
   * Revoke an active impersonation session.
   */
  async revokeSession(superAdminId: string, targetUserId: string) {
    try {
      const result = await prisma.impersonationSession.updateMany({
        where: { superAdminId, targetUserId, active: true },
        data: { active: false, revokedAt: new Date() },
      });

      await auditService.log({
        actorId: superAdminId,
        actorRole: "super_admin",
        action: "IMPERSONATION_REVOKE",
        details: { targetUserId, revokedCount: result.count },
      });

      logger.info(`[IMPERSONATION] Revoked ${result.count} session(s) for ${targetUserId} by ${superAdminId}`);
      return result.count;
    } catch (err: any) {
      logger.error(`[IMPERSONATION] Failed to revoke session: ${err?.message || err}`);
      throw Errors.Server("Failed to revoke impersonation session.");
    }
  }

  /**
   * List active impersonation sessions for monitoring / security dashboard.
   */
  async listActiveSessions() {
    try {
      return await prisma.impersonationSession.findMany({
        where: { active: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          superAdminId: true,
          targetUserId: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
    } catch (err: any) {
      logger.error(`[IMPERSONATION] Failed to list sessions: ${err?.message || err}`);
      throw Errors.Server("Failed to list impersonation sessions.");
    }
  }

  /**
   * Emergency: Force revoke all active impersonations and emit a security event.
   */
  async revokeAll() {
    try {
      const result = await prisma.impersonationSession.updateMany({
        where: { active: true },
        data: { active: false, revokedAt: new Date() },
      });

      await auditService.recordSecurityEvent({
        actorRole: "system",
        message: "Emergency impersonation session revocation executed.",
        severity: "high",
        metadata: { revokedCount: result.count },
      });

      logger.warn(`[IMPERSONATION] ⚠️ Force-revoked ${result.count} active session(s).`);
      return result.count;
    } catch (err: any) {
      logger.error(`[IMPERSONATION] Failed to force revoke sessions: ${err?.message || err}`);
      throw Errors.Server("Failed to force revoke impersonation sessions.");
    }
  }
}

export const impersonationService = new ImpersonationService();
export default impersonationService;