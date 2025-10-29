import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

/**
 * Invitation Repository
 * ------------------------------------------------------------
 * Handles creation, validation, and tracking of invitations
 * for athletes, coaches, and institution staff.
 * - Uses secure random tokens (hashed before storage)
 * - Expiration-based validation
 * - Tracks accepted/revoked states
 */
export const InvitationRepo = {
  /**
   * Generate a secure token for invitations.
   * The token is stored hashed for safety and the raw token
   * is returned for sending in the email or link.
   */
  generateToken() {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, hashedToken };
  },

  /**
   * Create a new invitation.
   * Automatically invalidates older invites for the same email & role.
   */
  async createInvitation(data: {
    email: string;
    invitedById: string;
    institutionId: string;
    role: "ATHLETE" | "COACH" | "ADMIN";
    expiresInHours?: number;
    message?: string;
  }) {
    const { rawToken, hashedToken } = this.generateToken();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (data.expiresInHours ?? 72)); // default 72h expiry

    try {
      // Invalidate old pending invitations for the same email
      await prisma.invitation.updateMany({
        where: { email: data.email, status: "PENDING" },
        data: { status: "REVOKED" },
      });

      const invitation = await prisma.invitation.create({
        data: {
          email: data.email.toLowerCase(),
          invitedById: data.invitedById,
          institutionId: data.institutionId,
          role: data.role,
          tokenHash: hashedToken,
          expiresAt,
          message: data.message ?? null,
          status: "PENDING",
        },
        include: {
          invitedBy: { select: { id: true, name: true, role: true } },
          institution: { select: { id: true, name: true } },
        },
      });

      return { invitation, token: rawToken };
    } catch (error) {
      console.error("❌ Error creating invitation:", error);
      throw new Error("Failed to create invitation");
    }
  },

  /**
   * Validate an invitation token before accepting.
   */
  async validateToken(token: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await prisma.invitation.findFirst({
      where: {
        tokenHash,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      include: {
        invitedBy: { select: { id: true, name: true, role: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    if (!invitation) throw new Error("Invalid or expired invitation token");

    return invitation;
  },

  /**
   * Mark an invitation as accepted after successful registration.
   */
  async markAsAccepted(invitationId: string, acceptedById: string) {
    try {
      const updated = await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "ACCEPTED",
          acceptedById,
          acceptedAt: new Date(),
        },
      });
      return updated;
    } catch (error) {
      console.error("❌ Error marking invitation accepted:", error);
      throw new Error("Failed to mark invitation as accepted");
    }
  },

  /**
   * Revoke or expire an invitation manually (e.g., by admin).
   */
  async revokeInvitation(invitationId: string, reason?: string) {
    try {
      const updated = await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          revokeReason: reason ?? "Revoked by admin",
        },
      });
      return updated;
    } catch (error) {
      console.error("❌ Error revoking invitation:", error);
      throw new Error("Failed to revoke invitation");
    }
  },

  /**
   * List invitations (filter by institution, role, or status).
   */
  async listInvitations(options?: {
    institutionId?: string;
    status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
    role?: "ATHLETE" | "COACH" | "ADMIN";
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

      return {
        invitations,
        pagination: {
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ Error listing invitations:", error);
      throw new Error("Failed to fetch invitations");
    }
  },
};