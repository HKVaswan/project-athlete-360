/**
 * Invitations Controller — Enterprise Hardened Build
 *
 * ✅ SHA256 token hashing (DB-safe, no raw secrets stored)
 * ✅ Role & quota enforcement (institution-scoped)
 * ✅ Bcrypt password hashing on acceptance
 * ✅ Audit logs for every lifecycle action
 * ✅ Integration with notification queue and fallback mailer
 * ✅ Anti-abuse tracking through trialAuditService
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

/* ------------------------------------------------------------
   🔐 Helpers
-------------------------------------------------------------*/
const generateTokenAndHash = (): { token: string; tokenHash: string } => {
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
};

const mask = (s: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : s);

/* ------------------------------------------------------------
   📨 Create Invitation (Admin or Approved Coach)
-------------------------------------------------------------*/
export const createInvitation = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const { email, role, institutionId: bodyInstitutionId } = req.body;
    if (!email || !role) throw Errors.Validation("Email and role are required.");
    if (!["athlete", "coach"].includes(role)) throw Errors.Validation("Invalid role type.");

    // 🔒 Role restrictions
    if (requester.role === "coach") {
      if (role === "coach") throw Errors.Forbidden("Coaches cannot invite other coaches.");
      if (!requester.institutionId) throw Errors.BadRequest("Coach must belong to an institution.");

      const coach = await prisma.user.findUnique({ where: { id: requester.id } });
      if (!coach || !coach.approved) throw Errors.Forbidden("Only approved coaches can send invitations.");
    }

    const targetInstitutionId = bodyInstitutionId ?? requester.institutionId;
    if (!targetInstitutionId) throw Errors.BadRequest("Institution must be provided or inferred.");

    // 🧠 Record invite attempt (anti-abuse)
    try {
      await trialAuditService.recordInviteAttempt({
        inviterId: requester.id,
        inviterRole: requester.role,
        email: email.toLowerCase(),
        ip: req.ip,
        userAgent: req.get("user-agent") || "unknown",
        time: new Date(),
      });
    } catch (err) {
      logger.warn("[INVITE] trialAuditService failed:", (err as Error).message);
    }

    // 🧮 Verify quota (institutional)
    await quotaService.verifyInstitutionLimit(targetInstitutionId, role);

    // 🚫 Prevent duplicate pending invite
    const existing = await prisma.invitation.findFirst({
      where: { email: email.toLowerCase(), role, institutionId: targetInstitutionId, status: "pending" },
    });
    if (existing) throw Errors.Duplicate("An active invitation already exists for this email.");

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

    // 📬 Queue notification
    const inviteLink = `${process.env.FRONTEND_URL || config.frontendUrl}/invite/accept?token=${token}`;
    try {
      await addNotificationJob({
        type: "custom",
        recipientId: email.toLowerCase(),
        title: `Invitation to join Project Athlete 360 as ${role}`,
        body: `${requester.name || requester.username || requester.email} has invited you as a ${role}.`,
        channel: ["email"],
        meta: { template: "invitation", templateContext: { inviter: requester.name, role, link: inviteLink } },
      });
    } catch (e) {
      logger.warn("[INVITE] Notification queue failed, fallback to direct email:", (e as Error).message);
      try {
        await sendEmail({
          to: email,
          subject: `Invitation to join Project Athlete 360 as ${role}`,
          template: "invitation",
          context: { inviter: requester.name || requester.email, role, link: inviteLink },
        });
      } catch (mailErr) {
        logger.warn("[INVITE] Email fallback failed:", (mailErr as Error).message);
      }
    }

    await auditService.log({
      actorId: requester.id,
      actorRole: requester.role,
      action: "INVITE_CREATE",
      ip: req.ip,
      details: { email, role, institutionId: targetInstitutionId, inviteId: invite.id, tokenPreview: mask(token) },
    });

    res.status(201).json({
      success: true,
      message: "Invitation created successfully.",
      data: { id: invite.id, email, token, expiresAt },
    });
  } catch (err: any) {
    logger.error("[INVITE] createInvitation failed:", err.message);
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   🔍 Validate Invitation Token
-------------------------------------------------------------*/
export const validateInvitation = async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || "");
    if (!token) throw Errors.Validation("Token is required.");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invite) throw Errors.NotFound("Invalid or expired invitation.");

    if (invite.expiresAt < new Date() || invite.status !== "pending") {
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: "expired" },
      });
      throw Errors.BadRequest("This invitation has expired or is no longer valid.");
    }

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
    logger.warn("[INVITE] validateInvitation failed:", err.message);
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ✅ Accept Invitation (Registration)
-------------------------------------------------------------*/
export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const { token, name, password } = req.body;
    if (!token || !name || !password) throw Errors.Validation("Token, name, and password are required.");

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
      throw Errors.BadRequest("Invalid or expired invitation.");
    }

    // Duplicate check
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw Errors.Duplicate("A user already exists with this email.");

    await quotaService.verifyInstitutionLimit(invite.institutionId!, invite.role);
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.email,
          name,
          username: invite.email.split("@")[0] + "-" + Math.floor(1000 + Math.random() * 9000),
          passwordHash,
          role: invite.role,
          institutionId: invite.institutionId ?? undefined,
          approved: invite.role === "coach" ? false : true,
        },
      });

      if (invite.role === "athlete") {
        await tx.athlete.create({
          data: {
            userId: user.id,
            name,
            athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
            institutionId: invite.institutionId ?? undefined,
            approved: true,
          },
        });
      } else if (invite.role === "coach") {
        await tx.coach.create({
          data: {
            userId: user.id,
            name,
            institutionId: invite.institutionId ?? undefined,
            approved: false,
          },
        });
      }

      await tx.invitation.update({
        where: { id: invite.id },
        data: { status: "accepted", acceptedAt: new Date() },
      });

      return user;
    });

    // Notify admins
    try {
      const admins = await prisma.user.findMany({
        where: { institutionId: invite.institutionId, role: "admin" },
        select: { email: true, name: true },
      });
      for (const admin of admins) {
        await addNotificationJob({
          type: "custom",
          recipientId: admin.email,
          title: `New ${invite.role} joined your institution`,
          body: `${created.name} accepted an invitation as ${invite.role}.`,
          channel: ["email", "inApp"],
          meta: { inviteId: invite.id, newUserId: created.id },
        });
      }
    } catch (e) {
      logger.warn("[INVITE] admin notify failed:", (e as Error).message);
    }

    await auditService.log({
      actorId: created.id,
      actorRole: invite.role,
      action: "INVITE_ACCEPT",
      ip: req.ip,
      details: { inviteId: invite.id, newUserId: created.id },
    });

    res.status(201).json({
      success: true,
      message: "Invitation accepted successfully.",
      data: { userId: created.id, email: created.email, role: created.role },
    });
  } catch (err: any) {
    logger.error("[INVITE] acceptInvitation failed:", err.message);
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ❌ Cancel / Revoke Invitation
-------------------------------------------------------------*/
export const cancelInvitation = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const { id } = req.params;
    const invite = await prisma.invitation.findUnique({ where: { id } });
    if (!invite) throw Errors.NotFound("Invitation not found.");

    if (
      invite.invitedById !== requester.id &&
      !["admin", "super_admin"].includes(requester.role)
    ) {
      throw Errors.Forbidden("Not authorized to revoke this invitation.");
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: "cancelled", revokedAt: new Date() },
    });

    await auditService.log({
      actorId: requester.id,
      actorRole: requester.role,
      action: "INVITE_CANCEL",
      ip: req.ip,
      details: { inviteId: id },
    });

    res.json({ success: true, message: "Invitation cancelled successfully." });
  } catch (err: any) {
    logger.error("[INVITE] cancelInvitation failed:", err.message);
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   📜 List Invitations (Admin / Coach / SuperAdmin)
-------------------------------------------------------------*/
export const listInvitations = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user;
    if (!requester) throw Errors.Auth("Authentication required.");

    const where: any = {};

    if (requester.role === "coach") {
      where.invitedById = requester.id;
    } else if (requester.role === "admin") {
      where.institutionId = req.query.institutionId ?? requester.institutionId;
    } else if (requester.role === "super_admin" && req.query.institutionId) {
      where.institutionId = String(req.query.institutionId);
    } else if (!["coach", "admin", "super_admin"].includes(requester.role)) {
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
      include: { invitedBy: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: "desc" },
    });

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
    logger.error("[INVITE] listInvitations failed:", err.message);
    sendErrorResponse(res, err);
  }
};