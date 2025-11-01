/**
 * src/controllers/auth.controller.ts
 * ---------------------------------------------------------------------------
 * Authentication Controller — Enterprise-Grade
 * ---------------------------------------------------------------------------
 * Features:
 *  - MFA for Admin/SuperAdmin
 *  - Institution-level linking (plan-aware)
 *  - Session versioning (auto token invalidation on password reset/logout-all)
 *  - Role-aware registration (Athlete/Coach public; Admins internal only)
 *  - Centralized audit logging
 *  - Institution plan quota validation
 * ---------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { config } from "../config";
import { auditService } from "../lib/audit";
import { generateMfaToken, verifyMfaCode } from "../services/mfa.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { quotaService } from "../services/quota.service";

/* ---------------------------------------------------------------------------
   🔧 Utility Generators
--------------------------------------------------------------------------- */
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
const generateCoachCode = () => `COACH-${Math.floor(1000 + Math.random() * 9000)}`;
const generateInstitutionCode = () => `INST-${Math.floor(1000 + Math.random() * 9000)}`;

/**
 * Sanitize user object for API responses
 */
const sanitizeUser = (user: any) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  institutionId: user.institutionId ?? null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * Generate access and refresh tokens with versioning & impersonation
 */
const generateTokens = (user: any, mfaVerified = false, impersonatedBy?: string) => {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    mfaVerified,
    impersonatedBy,
    sessionVersion: user.sessionVersion || 0,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  const refreshToken = jwt.sign({ userId: user.id }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });

  return { accessToken, refreshToken };
};

/* ---------------------------------------------------------------------------
   🧩 Register (Athlete / Coach)
--------------------------------------------------------------------------- */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, email, dob, gender, role, sport, institutionCode } = req.body;

    if (!username || !password || !role) throw Errors.Validation("Username, password and role are required");
    if (!["athlete", "coach"].includes(role)) {
      throw Errors.Forbidden("Public registration is only allowed for athletes and coaches");
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing) throw Errors.Duplicate("Username or email already exists");

    const institution = await prisma.institution.findUnique({ where: { code: institutionCode } });
    if (!institution) throw Errors.BadRequest("Invalid institution code");

    // Enforce institution plan user limits
    await quotaService.ensureWithinQuota(institution.id, role === "athlete" ? "athletes" : "coaches");

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        name,
        passwordHash,
        role,
        ...(role === "coach" && { coachCode: generateCoachCode() }),
        institutionId: institution.id,
      },
    });

    if (role === "athlete") {
      await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode: generateAthleteCode(),
          name,
          dob: dob ? new Date(dob) : null,
          gender,
          sport,
          contactInfo: email,
          institutionId: institution.id,
          approved: false, // Awaiting approval by institution admin
        },
      });
    }

    const tokens = generateTokens(user);

    await auditService.log({
      actorId: user.id,
      actorRole: role,
      action: "USER_REGISTER",
      details: { email, institutionCode },
    });

    res.status(201).json({
      success: true,
      message: "Registration successful. Pending admin approval if required.",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (err: any) {
    logger.error(`[AUTH] Registration failed: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   🔑 Login (MFA + Institution Checks + Session Version)
--------------------------------------------------------------------------- */
export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password, mfaCode } = req.body;
    if (!identifier || !password) throw Errors.Validation("Username/email and password are required");

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      include: { athlete: true, institution: true },
    });

    if (!user) throw Errors.Auth("Invalid credentials");
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Errors.Auth("Invalid credentials");

    // Check if institution is active and not suspended
    if (user.institution && user.role !== "super_admin" && !user.institution.active) {
      throw Errors.Forbidden("Institution account is inactive or suspended");
    }

    // Check athlete approval
    if (user.role === "athlete" && user.athlete && !user.athlete.approved) {
      throw Errors.Forbidden("Athlete account pending approval by institution admin");
    }

    // MFA requirement for admin/super_admin
    if (["admin", "super_admin"].includes(user.role)) {
      if (!mfaCode) {
        const challenge = await generateMfaToken(user.id);
        return res.status(206).json({
          success: false,
          code: "MFA_REQUIRED",
          message: "MFA code required to complete login",
          data: { challengeId: challenge.id, expiresIn: challenge.expiresIn },
        });
      }

      const verified = await verifyMfaCode(user.id, mfaCode);
      if (!verified) throw Errors.Auth("Invalid or expired MFA code");
    }

    const tokens = generateTokens(user, !!mfaCode);

    await auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: "USER_LOGIN",
      details: { mfa: !!mfaCode, ip: req.ip },
    });

    res.json({
      success: true,
      message: "Login successful",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (err: any) {
    logger.error(`[AUTH] Login failed: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   🔄 Refresh Token (Session-aware)
--------------------------------------------------------------------------- */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) throw Errors.Validation("Refresh token required");

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwt.refreshSecret);
    } catch {
      throw Errors.Auth("Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) throw Errors.NotFound("User not found");

    const tokens = generateTokens(user);
    res.json({ success: true, data: tokens });
  } catch (err: any) {
    logger.error(`[AUTH] Refresh token failed: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   👤 Me (with institution & quota details)
--------------------------------------------------------------------------- */
export const me = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) throw Errors.Auth("Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        athlete: true,
        institution: { select: { id: true, name: true, planTier: true, active: true } },
      },
    });
    if (!user) throw Errors.NotFound("User not found");

    const usage = user.institution
      ? await quotaService.getInstitutionUsage(user.institution.id)
      : null;

    res.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        athleteProfile: user.athlete ?? null,
        institution: user.institution ?? null,
        usage,
      },
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------------
   🚪 Logout (Audit + Token invalidation support)
--------------------------------------------------------------------------- */
export const logout = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user) {
      await auditService.log({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "USER_LOGOUT",
        details: { ip: req.ip },
      });
    }

    res.json({
      success: true,
      message: "Logout successful. Tokens invalidated client-side.",
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};