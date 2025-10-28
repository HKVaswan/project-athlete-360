/**
 * src/controllers/invitations.controller.ts
 * --------------------------------------------------------------
 * Handles invitation-based onboarding for coaches & athletes.
 *
 * Key Features:
 *  ✅ Secure, tokenized invitations with expiry
 *  ✅ Email integration (optional)
 *  ✅ Prevents duplicate/spam invites
 *  ✅ Works for both athlete & coach onboarding
 *  ✅ Fully logged and error-handled
 * --------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import crypto from "crypto";
import { sendEmail } from "../utils/email";

// Expiry in hours
const INVITE_EXPIRY_HOURS = 72;

/* ------------------------------------------------------------
   📨 Create Invitation (Admin or Coach)
-------------------------------------------------------------*/
export const createInvitation = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth("Authentication required.");

    const { email, role, institutionId } = req.body;

    if (!email || !role)
      throw Errors.Validation("Email and role are required.");

    if (!["athlete", "coach"].includes(role))
      throw Errors.Validation("Invalid role for invitation.");

    if (user.role === "coach" && role === "coach")
      throw Errors.Forbidden("Coaches cannot invite other coaches.");

    if (user.role === "coach" && !user.institutionId)
      throw Errors.BadRequest("Coach is not linked to an institution.");

    const targetInstitutionId =
      institutionId ?? user.institutionId ?? undefined;

    // Check duplicate invites
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

    // Generate secure token
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    const invite = await prisma.invitation.create({
      data: {
        email: email.toLowerCase(),
        token,
        invitedById: user.id,
        role,
        institutionId: targetInstitutionId,
        expiresAt,
        status: "pending",
      },
    });

    // Send invitation email (optional)
    try {
      await sendEmail({
        to: email,
        subject: `Invitation to join ${role === "coach" ? "as Coach" : "as Athlete"} on Project Athlete 360`,
        template: "invitation",
        context: {
          inviter: user.name || user.email,
          role,
          link: `${process.env.FRONTEND_URL}/invite/accept?token=${token}`,
        },
      });
    } catch (emailErr) {
      logger.warn("⚠️ Failed to send invite email:", emailErr);
    }

    res.status(201).json({
      success: true,
      message: "Invitation created successfully.",
      data: { id: invite.id, email: invite.email, token },
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   🔍 Validate Invitation Token (public route)
-------------------------------------------------------------*/
export const validateInvitation = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token) throw Errors.Validation("Token is required.");

    const invite = await prisma.invitation.findUnique({ where: { token: String(token) } });
    if (!invite) throw Errors.NotFound("Invalid or expired invitation.");

    if (invite.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: "expired" },
      });
      throw Errors.BadRequest("This invitation has expired.");
    }

    res.json({
      success: true,
      data: {
        email: invite.email,
        role: invite.role,
        institutionId: invite.institutionId,
      },
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ✅ Accept Invitation (Registration step)
-------------------------------------------------------------*/
export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const { token, name, password } = req.body;
    if (!token || !name || !password)
      throw Errors.Validation("Token, name, and password are required.");

    const invite = await prisma.invitation.findUnique({ where: { token } });
    if (!invite) throw Errors.NotFound("Invalid or expired invitation.");

    if (invite.expiresAt < new Date() || invite.status !== "pending")
      throw Errors.BadRequest("This invitation is no longer valid.");

    // Prevent duplicate accounts
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (existingUser) throw Errors.Duplicate("User already registered with this email.");

    // Create the new user
    const user = await prisma.user.create({
      data: {
        email: invite.email,
        name,
        passwordHash: password, // ⚠️ should be hashed in auth.service.ts
        role: invite.role,
        institutionId: invite.institutionId,
        approved: invite.role === "coach" ? false : true, // coaches need approval by admin
      },
    });

    // Update invitation status
    await prisma.invitation.update({
      where: { id: invite.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    res.status(201).json({
      success: true,
      message: "Invitation accepted successfully.",
      data: { userId: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   ❌ Cancel / Revoke Invitation (admin or inviter)
-------------------------------------------------------------*/
export const cancelInvitation = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const invite = await prisma.invitation.findUnique({ where: { id } });
    if (!invite) throw Errors.NotFound("Invitation not found.");

    if (invite.invitedById !== user?.id && user?.role !== "admin")
      throw Errors.Forbidden("You are not authorized to revoke this invitation.");

    await prisma.invitation.update({
      where: { id },
      data: { status: "cancelled" },
    });

    res.json({ success: true, message: "Invitation cancelled successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------
   📜 List All Invitations (Admin / Coach)
-------------------------------------------------------------*/
export const listInvitations = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth();

    const where: any = {};

    if (user.role === "coach") {
      where.invitedById = user.id;
    } else if (user.role === "admin") {
      const { institutionId } = req.query;
      if (institutionId) where.institutionId = String(institutionId);
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.invitation.count({ where }),
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

    res.json({ success: true, data: invitations, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};