/**
 * Invitation Repository — Enterprise Edition
 * ------------------------------------------------------------
 * Handles creation, validation, and tracking of invitations
 * for athletes, coaches, and admins.
 *
 * 🔒 Security:
 *  - Token stored as SHA256 hash (raw returned only once)
 *  - Old pending invites auto-revoked
 *  - Prevents spam / abuse via trialAuditService
 *
 * ⚙️ System:
 *  - Integrates with quotaService to enforce plan limits
 *  - Supports pagination & filters
 *  - Adds audit logging for all lifecycle changes
 * ------------------------------------------------------------
 */

import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { auditService } from "../lib/audit";
import { quotaService } from "../services/quota.service";
import { trialAuditService } from "../services/trialAudit.service";
import { Errors } from "../utils/errors";

export const InvitationRepo = {
  /**
   * Generate a secure random invitation token (raw + hash)
   */
  generateToken() {
    const rawToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, tokenHash };
  },

  /**
   * Create a new invitation.
   * - Invalidates any old pending ones for same email + role.
   * - Checks quota & abuse before creation.
   */
  async createInvitation(data: {
    email: string;
    invitedById: string;
    institutionId: string;
    role: "athlete" | "coach" | "admin";
    expiresInHours?: number;
    message?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const { rawToken, tokenHash } = this.generateToken();
    const expiresAt = new Date(Date.now() + (data.expiresInHours ?? 72) * 60 * 60 * 1000);

    const email = data.email.toLowerCase();

    // --- Anti-abuse & quota enforcement ---
    try {
      await Promise.all([
        quotaService.verifyInstitutionLimit(data.institutionId, data.role),
        trialAuditService.recordInviteAttempt({
          inviterId: data.invitedById,
          inviterRole: data.role,
          email,
          ip: data.ip ?? "unknown",
          userAgent: data.userAgent ?? "unknown",
          time: new Date(),
        }),
      ]);
    } catch (err) {
      logger.warn("[INVITE REPO] Quota or abuse check failed", err);
      // non-blocking in early beta
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Invalidate any previous pending invitations
        await tx.invitation.updateMany({
          where: { email, status: "pending" },
          data: { status: "revoked", revokedAt: new Date() },
        });

        // Create new invite
        await tx.invitation.create({
          data: {
            email,
            tokenHash,
            invitedById: data.invitedById,
            institutionId: data.institutionId,
            role: data.role,
            expiresAt,
            message: data.message ?? null,
            status: "pending",
          },
        });
      });

      await auditService.log({
        actorId: data.invitedById,
        actorRole: "system",
        action: "INVITE_CREATE",
        details: { email, role: data.role, institutionId: data.institutionId },
      });

      return { token: rawToken, expiresAt };
    } catch (error: any) {
      logger.error("[INVITE REPO] Failed to create invitation", error.message);
      throw Errors.ServiceUnavailable("Failed to create invitation");
    }
  },

  /**
   * Validate invitation token.
   * Returns invite details if valid, else throws.
   */
  async validateToken(token: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invite = await prisma.invitation.findFirst({
      where: {
        tokenHash,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      include: {
        invitedBy: { select: { id: true, name: true, role: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    if (!invite) throw Errors.NotFound("Invalid or expired invitation token");

    return invite;
  },

  /**
   * Mark an invitation as accepted after successful registration.
   */
  async markAsAccepted(inviteId: string, acceptedById: string) {
    try {
      const updated = await prisma.invitation.update({
        where: { id: inviteId },
        data: {
          status: "accepted",
          acceptedById,
          acceptedAt: new Date(),
        },
      });

      await auditService.log({
        actorId: acceptedById,
        actorRole: "system",
        action: "INVITE_ACCEPT",
        details: { inviteId },
      });

      return updated;
    } catch (error: any) {
      logger.error("[INVITE REPO] Error marking accepted:", error.message);
      throw Errors.ServiceUnavailable("Failed to mark invitation as accepted");
    }
  },

  /**
   * Manually revoke or expire an invitation (admin action)
   */
  async revokeInvitation(inviteId: string, actorId: string, reason?: string) {
    try {
      const updated = await prisma.invitation.update({
        where: { id: inviteId },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokeReason: reason ?? "Revoked manually",
        },
      });

      await auditService.log({
        actorId,
        actorRole: "admin",
        action: "INVITE_REVOKE",
        details: { inviteId, reason },
      });

      return updated;
    } catch (error: any) {
      logger.error("[INVITE REPO] Error revoking invitation:", error.message);
      throw Errors.ServiceUnavailable("Failed to revoke invitation");
    }
  },

  /**
   * List invitations with pagination & filtering.
   */
  async listInvitations(options?: {
    institutionId?: string;
    status?: "pending" | "accepted" | "revoked" | "expired";
    role?: "athlete" | "coach" | "admin";
    page?: number;
    limit?: number;
  }) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (options?.institutionId) where.institutionId = options.institutionId;
    if (options?.status) where.status = options.status;
    if (options?.role) where.role = options.role;

    try {
      const [invitations, total] = await Promise.all([
        prisma.invitation.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            invitedBy: { select: { id: true, name: true, role: true } },
            institution: { select: { id: true, name: true } },
          },
        }),
        prisma.invitation.count({ where }),
      ]);

      await auditService.log({
        actorId: "system",
        actorRole: "system",
        action: "INVITE_LIST_QUERY",
        details: { count: invitations.length, institutionId: options?.institutionId },
      });

      return {
        invitations,
        pagination: {
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      logger.error("[INVITE REPO] Error listing invitations:", error.message);
      throw Errors.ServiceUnavailable("Failed to list invitations");
    }
  },
};