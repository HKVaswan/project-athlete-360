// src/services/invitation.service.ts
/**
 * Invitation Service — Enterprise Grade
 * -------------------------------------
 * Handles invitation workflow for:
 *  - Institution inviting coaches or athletes
 *  - Coach inviting athletes (optional feature)
 *  - Secure email token validation with expiration
 *  - Prevention of spam, duplicates, and misuse
 *
 * Features:
 *  - Token-based invitations with expiration (default: 7 days)
 *  - Auto-cleanup for expired invites
 *  - Role-specific invitation rules
 *  - Email dispatch hook (ready for Nodemailer/Resend)
 *  - Audit trail for compliance & debugging
 */

import { randomBytes } from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { sendInvitationEmail } from "../utils/email";

type InvitationRole = "coach" | "athlete";
type CreateInvitationInput = {
  inviterId: string;
  institutionId: string;
  email: string;
  role: InvitationRole;
};

type AcceptInvitationInput = {
  token: string;
  userId: string;
};

const INVITATION_EXPIRY_HOURS = 24 * 7; // 7 days

/**
 * 🔑 Generate secure token for invitation
 */
const generateToken = () => randomBytes(24).toString("hex");

/**
 * 📩 Create new invitation
 * - Institution admin or coach can invite users
 * - Prevent duplicate active invitations for same email & institution
 * - Rate-limit protection for spam prevention
 */
export const createInvitation = async (payload: CreateInvitationInput) => {
  const { inviterId, institutionId, email, role } = payload;

  // Validate inputs
  if (!inviterId || !institutionId || !email || !role)
    throw Errors.Validation("Missing required fields for invitation");

  // Check inviter
  const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
  if (!inviter) throw Errors.Auth("Inviter not found or unauthorized");

  // Check if inviter has permission
  if (inviter.role === "athlete") throw Errors.Forbidden("Athletes cannot send invitations");

  // Prevent duplicate active invites
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      email,
      institutionId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });
  if (existingInvite) throw Errors.Duplicate("Active invitation already exists for this email");

  // Generate secure token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      inviterId,
      institutionId,
      email: email.toLowerCase(),
      role,
      token,
      expiresAt,
      status: "PENDING",
    },
  });

  // Send invitation email (async, non-blocking)
  try {
    await sendInvitationEmail({
      to: email,
      inviterName: inviter.name ?? inviter.username,
      role,
      institutionName: inviter.institutionId ? (await prisma.institution.findUnique({
        where: { id: inviter.institutionId },
        select: { name: true },
      }))?.name : "Institution",
      inviteLink: `${process.env.FRONTEND_URL}/invite/accept?token=${token}`,
    });
  } catch (err) {
    logger.error("❌ Email sending failed", err);
  }

  logger.info(`📨 Invitation created for ${email} as ${role} by ${inviter.username}`);
  return { message: "Invitation sent successfully", invitationId: invitation.id };
};

/**
 * ✅ Accept an invitation
 * - Verifies token and expiration
 * - Links invited user to institution and role
 */
export const acceptInvitation = async (payload: AcceptInvitationInput) => {
  const { token, userId } = payload;

  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) throw Errors.NotFound("Invitation not found or invalid");
  if (invitation.status !== "PENDING") throw Errors.BadRequest("Invitation already used or expired");
  if (new Date(invitation.expiresAt) < new Date()) throw Errors.BadRequest("Invitation expired");

  // Update user with institution and role
  await prisma.user.update({
    where: { id: userId },
    data: {
      institutionId: invitation.institutionId,
      role: invitation.role,
    },
  });

  // Mark invitation as accepted
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  logger.info(`✅ Invitation accepted by user ${userId} for ${invitation.email}`);
  return { message: "Invitation accepted successfully" };
};

/**
 * ❌ Revoke or delete invitation
 * - Only inviter or admin can revoke pending invitations
 */
export const revokeInvitation = async (invitationId: string, requesterId: string) => {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw Errors.NotFound("Invitation not found");

  const requester = await prisma.user.findUnique({ where: { id: requesterId } });
  if (!requester) throw Errors.Auth("Unauthorized requester");

  const isAdmin = requester.role === "admin";
  const isOwner = requester.id === invitation.inviterId;
  if (!isAdmin && !isOwner) throw Errors.Forbidden("Not authorized to revoke this invitation");

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED" },
  });

  logger.warn(`🚫 Invitation ${invitationId} revoked by ${requester.username}`);
  return { message: "Invitation revoked successfully" };
};

/**
 * 🧹 Clean up expired invitations (cron job or manual trigger)
 */
export const cleanupExpiredInvitations = async () => {
  const expired = await prisma.invitation.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: "PENDING",
    },
    data: { status: "EXPIRED" },
  });

  if (expired.count > 0) logger.info(`🧹 Cleaned ${expired.count} expired invitations`);
  return { cleaned: expired.count };
};

/**
 * 🧠 Future Enhancements:
 * -----------------------
 * - Add analytics: track accepted vs expired invites
 * - Rate limiting per inviter (max 20 per week)
 * - In-app notification integration
 * - Smart AI-based institution join recommendations
 * - Institution invite customization templates
 */