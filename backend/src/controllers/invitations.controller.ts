// src/controllers/invitations.controller.ts
/**
 * Invitations Controller (Hardened Enterprise Version)
 *
 * - Tokens stored as SHA256(token) in DB (prevents token leakage if DB compromised)
 * - Raw token returned once to caller (needed to send to invitee)
 * - Quota & anti-abuse checks on creation
 * - Audit logging for all invite lifecycle events
 * - Uses notification queue for email/push (reliable delivery)
 */

import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";
import { auditService } from "../lib/audit";
import { quotaService } from "../services/quota.service";
import { trialAuditService } from "../services/trialAudit.service";
import { addNotificationJob } from "../workers/notification.worker";
import { sendEmail } from "../utils/email";
import { config } from "../config";

const INVITE_EXPIRY_HOURS = Number(process.env.INVITE_EXPIRY_HOURS || config.inviteExpiryHours || 72);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

// Helper to create token + hash
const generateTokenAndHash = (): { token: string; tokenHash: string } => {
  const token = crypto.randomBytes(24).toString("hex"); // 48 chars hex
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
};

// Mask string for safe log showing (keep only start/end)
const mask = (s: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : s);

/* ------------------------------------------------------------
   📨 Create Invitation (Admin or Coach)
   - Only admin or approved coach can create invites
   - Coaches cannot invite other coaches
   - Check institution quota before creating invite
   - Record invite attempt to trialAuditService to detect abuse
-------------------------------------------------------------*/
export const createInvitation = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const { email, role, institutionId: bodyInstitutionId } = req.body;
    if (!email || !role) throw Errors.Validation("Email and role are required.");
    if (!["athlete", "coach"].includes(role)) throw Errors.Validation("Invalid role for invitation.");

    // Ensure inviter has rights
    if (requester.role === "coach") {
      // coaches cannot invite coaches
      if (role === "coach") throw Errors.Forbidden("Coaches cannot invite other coaches.");
      // coach must be approved and belong to an institution
      if (!requester.institutionId) throw Errors.BadRequest("Coach is not linked to an institution.");
      // If coach is not approved (e.g. pending) block invite
      const coachRecord = await prisma.user.findUnique({ where: { id: requester.id } });
      if (!coachRecord || (coachRecord as any).approved === false) {
        throw Errors.Forbidden("Only approved coaches can create invitations.");
      }
    }

    // Determine target institution (explicit or inferred from requester)
    const targetInstitutionId = bodyInstitutionId ?? requester.institutionId;
    if (!targetInstitutionId) throw Errors.BadRequest("Institution must be provided or determined from inviter.");

    // Anti-abuse / trial invite attempt record
    try {
      await trialAuditService.recordInviteAttempt({
        inviterId: requester.id,
        inviterRole: requester.role,
        email: email.toLowerCase(),
        ip: req.ip,
        userAgent: req.get("user-agent") || "unknown",
        time: new Date(),
      });
    } catch (e) {
      logger.warn("[INVITE] trialAudit record failed", (e as Error).message);
      // non-blocking
    }

    // Quota verification (prevents over-subscription)
    await quotaService.verifyInstitutionLimit(targetInstitutionId, role);

    // Prevent duplicate pending invite
    const existing = await prisma.invitation.findFirst({
      where: {
        email: email.toLowerCase(),
        role,
        institutionId: targetInstitutionId,
        status: "pending",
      },
    });
    if (existing) {
      throw Errors.Duplicate("An active invitation already exists for this user.");
    }

    // Create token and store only hash
    const { token, tokenHash } = generateTokenAndHash();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    const invite = await prisma.invitation.create({
      data: {
        email: email.toLowerCase(),
        tokenHash,
        invitedById: requester.id,
        role,
        institutionId: targetInstitutionId,
        expiresAt,
        status: "pending",
      },
    });

    // Queue notification to invitee (email) via worker — gives retries & backoff
    try {
      await addNotificationJob({
        type: "custom",
        recipientId: email.toLowerCase(),
        title: `Invitation to join as ${role} on Project Athlete 360`,
        body: `${requester.name || requester.username || requester.email} invited you as ${role}. Open the link to accept.`,
        channel: ["email"],
        meta: {
          template: "invitation",
          templateContext: {
            inviter: requester.name || requester.email || requester.username,
            role,
            link: `${process.env.FRONTEND_URL || config.frontendUrl}/invite/accept?token=${token}`,
          },
        },
      });
    } catch (err) {
      logger.warn("[INVITE] Failed to queue notification, attempting direct send:", (err as Error).message);
      // Best-effort direct send fallback
      try {
        await sendEmail({
          to: email,
          subject: `Invitation to join Project Athlete 360 as ${role}`,
          template: "invitation",
          context: {
            inviter: requester.name || requester.email || requester.username,
            role,
            link: `${process.env.FRONTEND_URL || config.frontendUrl}/invite/accept?token=${token}`,
          },
        });
      } catch (e) {
        logger.warn("[INVITE] Direct email fallback failed:", (e as Error).message);
      }
    }

    // Audit log
    await auditService.log({
      actorId: requester.id,
      actorRole: requester.role,
      action: "INVITE_CREATE",
      ip: req.ip,
      details: {
        email: email.toLowerCase(),
        role,
        institutionId: targetInstitutionId,
        inviteId: invite.id,
        tokenPreview: mask(token),
      },
    });

    // Return raw token only once (caller must deliver via email or copy)
    res.status(201).json({
      success: true,
      message: "Invitation created successfully.",
      data: {
        id: invite.id,
        email: invite.email,
        token, // raw token — store only hash in DB
        expiresAt,
      },
    });
  } catch (err: any) {
    logger.error("[INVITE] createInvitation failed", { err: err.message, ip: req.ip });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   🔍 Validate Invitation Token (public route)
   - token passed as query param (raw token)
-------------------------------------------------------------*/
export const validateInvitation = async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || "");
    if (!token) throw Errors.Validation("Token is required.");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invite = await prisma.invitation.findFirst({ where: { tokenHash } });
    if (!invite) throw Errors.NotFound("Invalid or expired invitation.");

    // expired -> mark expired
    if (invite.expiresAt < new Date() || invite.status !== "pending") {
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: invite.expiresAt < new Date() ? "expired" : invite.status },
      });

      await auditService.log({
        actorId: invite.invitedById,
        actorRole: "system",
        action: "INVITE_VALIDATE",
        details: { inviteId: invite.id, result: "invalid_or_expired" },
      });

      throw Errors.BadRequest("This invitation is no longer valid.");
    }

    // Success
    await auditService.log({
      actorId: invite.invitedById,
      actorRole: "system",
      action: "INVITE_VALIDATE",
      details: { inviteId: invite.id, result: "valid" },
    });

    res.json({
      success: true,
      data: {
        email: invite.email,
        role: invite.role,
        institutionId: invite.institutionId,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (err: any) {
    logger.warn("[INVITE] validateInvitation failed", { err: err.message });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ✅ Accept Invitation (Registration step)
   - raw token + name + password
   - password saved hashed (bcrypt)
   - creates user and role-specific records (athlete/coach)
-------------------------------------------------------------*/
export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const { token, name, password } = req.body;
    if (!token || !name || !password) throw Errors.Validation("Token, name, and password are required.");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });

    if (!invite) throw Errors.NotFound("Invalid or expired invitation.");
    if (invite.expiresAt < new Date() || invite.status !== "pending")
      throw Errors.BadRequest("This invitation is no longer valid.");

    // Check duplicate user by email
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw Errors.Duplicate("User already registered with this email.");

    // Quota check before creating user (defense-in-depth)
    await quotaService.verifyInstitutionLimit(invite.institutionId!, invite.role);

    // Hash password securely
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    // Create user (and athlete/coach record as needed) inside transaction
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.email,
          name,
          username: invite.email.split("@")[0] + "-" + Math.floor(1000 + Math.random() * 9000),
          passwordHash,
          role: invite.role,
          institutionId: invite.institutionId ?? undefined,
          approved: invite.role === "coach" ? false : true, // coaches might need admin approval
        },
      });

      let roleRecord: any = null;
      if (invite.role === "athlete") {
        roleRecord = await tx.athlete.create({
          data: {
            userId: user.id,
            athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
            name,
            contactInfo: invite.email,
            institutionId: invite.institutionId ?? undefined,
            approved: true, // invited athlete considered approved by invite flow
          },
        });
      } else if (invite.role === "coach") {
        // create coach row or any coach-specific linking
        roleRecord = await tx.coach.create({
          data: {
            userId: user.id,
            name,
            institutionId: invite.institutionId ?? undefined,
            approved: false, // require admin approval for coach
          },
        });
      }

      // Mark invite accepted
      await tx.invitation.update({
        where: { id: invite.id },
        data: { status: "accepted", acceptedAt: new Date() },
      });

      return { user, roleRecord };
    });

    // Notifications: inform institution admin(s)
    try {
      const admins = await prisma.user.findMany({
        where: { institutionId: invite.institutionId, role: "admin" },
        select: { id: true, email: true, name: true },
      });

      for (const admin of admins) {
        await addNotificationJob({
          type: "custom",
          recipientId: admin.email,
          title: `New ${invite.role} accepted invitation`,
          body: `${created.user.name} accepted invitation to join ${invite.role}.`,
          channel: ["email", "inApp"],
          meta: { inviteId: invite.id, newUserId: created.user.id },
        });
      }
    } catch (e) {
      logger.warn("[INVITE] notify admins failed:", (e as Error).message);
    }

    // Audit log
    await auditService.log({
      actorId: created.user.id,
      actorRole: invite.role,
      action: "INVITE_ACCEPT",
      ip: req.ip,
      details: { inviteId: invite.id, createdUserId: created.user.id },
    });

    res.status(201).json({
      success: true,
      message: "Invitation accepted successfully.",
      data: { userId: created.user.id, email: created.user.email, role: created.user.role },
    });
  } catch (err: any) {
    logger.error("[INVITE] acceptInvitation failed", { err: err.message });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ❌ Cancel / Revoke Invitation (admin or inviter)
-------------------------------------------------------------*/
export const cancelInvitation = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const { id } = req.params;
    const invite = await prisma.invitation.findUnique({ where: { id } });
    if (!invite) throw Errors.NotFound("Invitation not found.");

    // authorization: invitedBy OR institution admin OR super_admin
    if (
      invite.invitedById !== requester.id &&
      requester.role !== "admin" &&
      requester.role !== "super_admin"
    ) {
      throw Errors.Forbidden("You are not authorized to revoke this invitation.");
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: "cancelled", revokedAt: new Date() },
    });

    await auditService.log({
      actorId: requester.id,
      actorRole: requester.role,
      action: "INVITE_CANCEL",
      details: { inviteId: id },
      ip: req.ip,
    });

    res.json({ success: true, message: "Invitation cancelled successfully." });
  } catch (err: any) {
    logger.error("[INVITE] cancelInvitation failed", { err: err.message });
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   📜 List All Invitations (Admin / Coach)
-------------------------------------------------------------*/
export const listInvitations = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const where: any = {};

    if (requester.role === "coach") {
      where.invitedById = requester.id;
    } else if (requester.role === "admin") {
      const { institutionId } = req.query;
      if (institutionId) where.institutionId = String(institutionId);
      else where.institutionId = requester.institutionId ?? undefined;
    } else if (requester.role === "super_admin") {
      // super admin can view all optionally filtered by query params
      if (req.query.institutionId) where.institutionId = String(req.query.institutionId);
    } else {
      throw Errors.Forbidden("Not authorized to list invitations.");
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (w) => prisma.invitation.count({ where: w }),
      where,
    });

    const invitations = await prisma.invitation.findMany({
      ...prismaArgs,
      where,
      include: {
        invitedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // audit: if listing large sets, record an event for compliance
    if ((meta?.total ?? 0) > 100) {
      await auditService.log({
        actorId: requester.id,
        actorRole: requester.role,
        action: "INVITE_LIST_LARGE",
        details: { count: meta.total || 0 },
      });
    }

    res.json({ success: true, data: invitations, meta });
  } catch (err: any) {
    logger.error("[INVITE] listInvitations failed", { err: err.message });
    sendErrorResponse(res, err);
  }
};