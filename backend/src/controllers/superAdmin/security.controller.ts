/**
 * src/controllers/superAdmin/security.controller.ts
 * ----------------------------------------------------------------------
 * Super Admin Security Controller
 *
 * Responsibilities:
 *  - Multi-Factor Authentication (MFA) setup and verification
 *  - Secret & key rotation (JWT, encryption)
 *  - Intrusion detection and breach response
 *  - Maintenance mode toggling
 * ----------------------------------------------------------------------
 */

import { Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import prisma from "../../prismaClient";
import { config } from "../../config";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { recordAuditEvent } from "../../services/audit.service";
import { revokeAllSessions } from "../../services/session.service";

/* -----------------------------------------------------------------------
   🧩 Utility: Super Admin validation
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super Admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   🔐 1. Setup MFA (TOTP)
------------------------------------------------------------------------*/
export const setupMFA = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const secret = speakeasy.generateSecret({
      name: `ProjectAthlete360 (${superAdmin.username})`,
      length: 32,
    });

    const qrCodeDataURL = await qrcode.toDataURL(secret.otpauth_url!);

    await prisma.user.update({
      where: { id: superAdmin.id },
      data: {
        mfaSecret: secret.base32,
      },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "MFA_SETUP_INITIATED",
    });

    res.json({
      success: true,
      message: "MFA setup initiated. Scan the QR code with your authenticator app.",
      data: { qrCodeDataURL, base32: secret.base32 },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SECURITY] setupMFA failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔑 2. Verify MFA Code
------------------------------------------------------------------------*/
export const verifyMFA = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { token } = req.body;
    if (!token) throw Errors.Validation("MFA code is required.");

    const user = await prisma.user.findUnique({ where: { id: superAdmin.id } });
    if (!user?.mfaSecret) throw Errors.BadRequest("MFA not set up for this account.");

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: "base32",
      token,
      window: 1,
    });

    if (!verified) throw Errors.Auth("Invalid MFA code.");

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaVerified: true },
    });

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "MFA_VERIFIED",
    });

    res.json({
      success: true,
      message: "MFA verified successfully.",
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SECURITY] verifyMFA failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔄 3. Rotate JWT / Encryption Keys
------------------------------------------------------------------------*/
export const rotateKeys = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { type } = req.body; // jwt | encryption
    if (!["jwt", "encryption"].includes(type)) throw Errors.Validation("Invalid key type.");

    const newKey = crypto.randomBytes(64).toString("hex");

    if (type === "jwt") {
      await prisma.systemSetting.upsert({
        where: { key: "JWT_SECRET" },
        update: { value: newKey },
        create: { key: "JWT_SECRET", value: newKey },
      });

      await revokeAllSessions();
      logger.warn("[SECURITY] JWT secret rotated. All sessions revoked.");
    } else {
      await prisma.systemSetting.upsert({
        where: { key: "ENCRYPTION_KEY" },
        update: { value: newKey },
        create: { key: "ENCRYPTION_KEY", value: newKey },
      });
    }

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "KEY_ROTATION",
      details: { type },
    });

    res.json({
      success: true,
      message: `${type.toUpperCase()} key rotated successfully.`,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SECURITY] rotateKeys failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚨 4. Trigger Security Lockdown
------------------------------------------------------------------------*/
export const triggerLockdown = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { reason } = req.body;

    await prisma.systemSetting.upsert({
      where: { key: "SYSTEM_LOCKDOWN" },
      update: { value: "true" },
      create: { key: "SYSTEM_LOCKDOWN", value: "true" },
    });

    await revokeAllSessions();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_LOCKDOWN",
      details: { reason },
    });

    logger.error(`[SECURITY] 🚨 SYSTEM LOCKDOWN initiated by ${superAdmin.username}`);

    res.json({
      success: true,
      message: "System lockdown activated. All sessions have been revoked.",
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SECURITY] triggerLockdown failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🩺 5. Security Health Check
------------------------------------------------------------------------*/
export const getSecurityStatus = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const jwtSecret = await prisma.systemSetting.findUnique({ where: { key: "JWT_SECRET" } });
    const encryptionKey = await prisma.systemSetting.findUnique({ where: { key: "ENCRYPTION_KEY" } });
    const lockdownStatus = await prisma.systemSetting.findUnique({ where: { key: "SYSTEM_LOCKDOWN" } });

    const stats = {
      jwtKeyLastUpdated: jwtSecret?.updatedAt || null,
      encryptionKeyLastUpdated: encryptionKey?.updatedAt || null,
      lockdownActive: lockdownStatus?.value === "true",
    };

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SECURITY_STATUS_CHECK",
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:SECURITY] getSecurityStatus failed", { err });
    sendErrorResponse(res, err);
  }
};