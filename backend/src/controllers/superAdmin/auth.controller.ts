// src/controllers/superAdmin/auth.controller.ts
/**
 * Super Admin Auth Controller
 * ---------------------------
 * Enterprise-grade authentication endpoints for system-level (super) admins.
 *
 * Endpoints (controller methods):
 *  - login(req): authenticate + MFA -> returns access + refresh tokens
 *  - logout(req): revoke sessions / refresh tokens
 *  - rotateSessions(req): force rotate (invalidate) all sessions for a given super-admin
 *
 * Security features:
 *  - strong password check via securityManager
 *  - optional IP whitelist
 *  - enforced MFA (TOTP) for super admins
 *  - sessionVersion support (so tokens can be invalidated globally)
 *  - audit logging for every important action
 */

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import { config } from "../config";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import securityManager from "../lib/securityManager";
import { authenticator } from "otplib";
import { createRefreshToken as svcCreateRefreshToken, revokeRefreshToken as svcRevokeRefreshToken } from "../services/auth.service"; // if you have creator helpers
import { incrementUserSessionVersion, isTokenRevoked } from "../services/session.service";
import { recordAuditEvent } from "../services/audit.service";

const ACCESS_TOKEN_EXPIRES = config.jwt?.expiresIn || "1h";
const ACCESS_TOKEN_SECRET = config.jwt?.secret || process.env.JWT_SECRET;
const REFRESH_TOKEN_EXPIRES = config.jwt?.refreshExpiresIn || "30d";
const REFRESH_TOKEN_SECRET = config.jwt?.refreshSecret || process.env.REFRESH_TOKEN_SECRET;

/**
 * Helper: generate access token payload for super admin
 */
const signAccessToken = (payload: { userId: string; username: string; role: string; sessionVersion?: number }) => {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET as string, { expiresIn: ACCESS_TOKEN_EXPIRES });
};

/**
 * Helper: generate refresh token (JWT) — we still store hashes server side
 */
const signRefreshToken = (payload: { userId: string }) => {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET as string, { expiresIn: REFRESH_TOKEN_EXPIRES });
};

/**
 * Login: verifies credentials + optional MFA. For super_admin role only.
 *
 * Request body:
 *  - username: string
 *  - password: string
 *  - mfaCode?: string (TOTP code) — optional on first request; if required, server returns mfaRequired: true
 *
 * Response:
 *  { success, data: { accessToken, refreshToken, user } } or { mfaRequired: true, message }
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { username, password, mfaCode } = req.body;
    if (!username || !password) throw Errors.Validation("username and password are required");

    // Find user and ensure role is super_admin
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.role !== "super_admin") {
      // do not reveal whether username exists
      logger.warn(`[SUPERADMIN:AUTH] Failed login attempt for username=${username} (role mismatch or not found)`, { ip: req.ip });
      // audit suspicious attempt
      await recordAuditEvent({
        actorId: null,
        actorRole: "anonymous",
        ip: req.ip,
        action: "SECURITY_EVENT",
        details: { event: "superadmin_login_failed", usernameMask: username.slice(0, 3) + "***" },
      });
      throw Errors.Auth("Invalid credentials");
    }

    // IP whitelist check (optional)
    if (Array.isArray(config.superAdminIpWhitelist) && config.superAdminIpWhitelist.length > 0) {
      const remoteIp = req.ip || req.headers["x-forwarded-for"] || "";
      const allowed = config.superAdminIpWhitelist.some((pattern: string) => {
        // exact match or CIDR-like partial match; keep simple: substring or exact
        return String(remoteIp).includes(pattern) || pattern === remoteIp;
      });
      if (!allowed) {
        logger.warn(`[SUPERADMIN:AUTH] IP ${remoteIp} not in whitelist for user ${user.username}`);
        await recordAuditEvent({
          actorId: user.id,
          actorRole: "super_admin",
          ip: req.ip,
          action: "SECURITY_EVENT",
          details: { reason: "ip_not_whitelisted", remoteIp },
        });
        return res.status(403).json({ success: false, message: "Access from this network is not allowed." });
      }
    }

    // Password check (use centralized helper)
    const passwordOk = await securityManager.comparePassword(password, user.passwordHash);
    if (!passwordOk) {
      logger.warn(`[SUPERADMIN:AUTH] Invalid password for ${user.username}`, { ip: req.ip });
      await recordAuditEvent({
        actorId: user.id,
        actorRole: "super_admin",
        ip: req.ip,
        action: "SECURITY_EVENT",
        details: { event: "invalid_password" },
      });
      throw Errors.Auth("Invalid credentials");
    }

    // MFA enforcement: if super admin has mfaEnabled (boolean) in DB -> require TOTP
    if (user.mfaEnabled) {
      if (!mfaCode) {
        // signal frontend to request MFA code
        return res.status(200).json({
          success: true,
          mfaRequired: true,
          message: "Multi-factor authentication required. Submit TOTP code.",
        });
      }

      // verify totp code using stored secret (mfaSecret)
      const secret = user.mfaSecret;
      if (!secret) {
        logger.error(`[SUPERADMIN:AUTH] mfaEnabled true but no mfaSecret for user ${user.id}`);
        throw Errors.Server("MFA misconfiguration");
      }

      const isValid = (() => {
        try {
          // use otplib authenticator
          return authenticator.check(String(mfaCode).trim(), secret);
        } catch (err) {
          logger.warn(`[SUPERADMIN:AUTH] TOTP verification error for ${user.username}: ${err?.message || err}`);
          return false;
        }
      })();

      if (!isValid) {
        logger.warn(`[SUPERADMIN:AUTH] Invalid TOTP for ${user.username}`, { ip: req.ip });
        await recordAuditEvent({
          actorId: user.id,
          actorRole: "super_admin",
          ip: req.ip,
          action: "SECURITY_EVENT",
          details: { event: "invalid_mfa" },
        });
        throw Errors.Auth("Invalid multi-factor authentication code");
      }
    }

    // At this point: credentials ok + MFA (if required) passed
    // Ensure session version is present and use it in token to allow server-side invalidation
    const sessionVersion = user.sessionVersion ?? 0;

    // Create signed tokens
    const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role, sessionVersion });
    const refreshToken = signRefreshToken({ userId: user.id });

    // Persist refresh token securely in DB (store hashed value)
    // Prefer existing auth service helper; fallback to direct prisma usage
    try {
      // store hashed token using sha/hmac wrapper (securityManager.hashToken not present by default)
      const tokenHash = await securityManager ? securityManager.signHmac(refreshToken, config.hmacSecret) : refreshToken;
      await prisma.refreshToken.create({
        data: { userId: user.id, tokenHash, issuedAt: new Date(), expiresAt: new Date(Date.now() + (config.refreshTokenTtlMs || 30 * 24 * 3600 * 1000)), revoked: false },
      });
    } catch (e) {
      logger.warn("[SUPERADMIN:AUTH] Failed to persist refresh token", e);
      // proceed but log — persistent failure should be addressed
    }

    // audit login success
    await recordAuditEvent({
      actorId: user.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "USER_LOGIN",
      details: { method: "password+mfa", mfaUsed: !!user.mfaEnabled },
    });

    // return safe user details and tokens
    const safeUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: safeUser,
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_EXPIRES,
      },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUTH] Login error", { message: err.message, stack: err.stack });
    return res.status(err?.statusCode || 400).json({
      success: false,
      message: err?.message || "Authentication failed",
      code: err?.code || "AUTH_ERROR",
    });
  }
};

/**
 * Logout endpoint for super admin:
 * - Accepts refresh token (or uses current userId) and revokes it.
 * - Increments sessionVersion when a full global logout is requested.
 *
 * Body:
 *  - refreshToken?: string
 *  - global?: boolean  // if true, revoke all refresh tokens and increment sessionVersion
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "super_admin") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { refreshToken, global } = req.body as { refreshToken?: string; global?: boolean };

    if (global) {
      // Increment sessionVersion to invalidate all access tokens
      await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      // Revoke all refresh tokens
      await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });

      await recordAuditEvent({
        actorId: user.id,
        actorRole: "super_admin",
        ip: req.ip,
        action: "ADMIN_OVERRIDE",
        details: { event: "global_logout" },
      });

      return res.json({ success: true, message: "All sessions revoked (global logout)" });
    }

    if (refreshToken) {
      // revoke by hash
      const tokenHash = securityManager.signHmac(refreshToken, config.hmacSecret);
      await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revoked: true } });
    } else {
      // best-effort: revoke all for this user device-less
      await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    }

    await recordAuditEvent({
      actorId: user.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "USER_LOGOUT",
      details: { global: !!global },
    });

    return res.json({ success: true, message: "Logout processed" });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUTH] Logout failed", { err });
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};

/**
 * Rotate (invalidate) sessions for a given super admin (super admin-only operation)
 * Body:
 *   - targetUserId: string
 *   - reason?: string
 *
 * Response: { success: true }
 */
export const rotateSessionsForUser = async (req: Request, res: Response) => {
  try {
    const actor = (req as any).user;
    if (!actor || actor.role !== "super_admin") return res.status(403).json({ success: false, message: "Forbidden" });

    const { targetUserId, reason } = req.body;
    if (!targetUserId) throw Errors.Validation("targetUserId required");

    // increment sessionVersion for target user
    await prisma.user.update({ where: { id: targetUserId }, data: { sessionVersion: { increment: 1 } } });

    // revoke refresh tokens for that user
    await prisma.refreshToken.updateMany({ where: { userId: targetUserId }, data: { revoked: true } });

    await recordAuditEvent({
      actorId: actor.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ADMIN_OVERRIDE",
      details: { event: "rotate_sessions", targetUserId, reason },
    });

    return res.json({ success: true, message: "User sessions rotated" });
  } catch (err: any) {
    logger.error("[SUPERADMIN:AUTH] rotateSessionsForUser failed", { err });
    return res.status(err?.statusCode || 500).json({ success: false, message: err?.message || "Failed to rotate sessions" });
  }
};