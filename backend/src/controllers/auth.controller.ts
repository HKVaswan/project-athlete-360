/**
 * src/controllers/auth.controller.ts
 * ---------------------------------------------------------------------
 * Handles user registration, login, token generation, and identity checks.
 * Supports multiple onboarding flows: athlete, coach, and admin.
 * Includes validation, approval logic, and secure JWT token handling.
 */

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { ApiError } from "../utils/errors";
import { config } from "../config";
import { randomUUID } from "crypto";

/* -----------------------------------------------------------------------
   🧩 Utility Helpers
------------------------------------------------------------------------*/
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
const generateCoachCode = () => `COACH-${Math.floor(1000 + Math.random() * 9000)}`;
const generateInstitutionCode = () => `INST-${Math.floor(1000 + Math.random() * 9000)}`;

/**
 * Sanitize user for response (removes sensitive data)
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
 * Generate JWT access + refresh tokens
 */
const generateTokens = (user: any) => {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken };
};

/* -----------------------------------------------------------------------
   🔐 Register
------------------------------------------------------------------------*/
/**
 * Handles registration of athletes, coaches, and admins.
 * Athletes -> must use institution code (coach optional)
 * Coaches -> must use institution code or invitation
 * Admins  -> registered separately through onboarding flow (payment gateway)
 */
export const register = async (req: Request, res: Response) => {
  try {
    const {
      username,
      password,
      name,
      email,
      dob,
      gender,
      role,
      sport,
      institutionCode,
      coachCode,
    } = req.body;

    if (!username || !password || !role) {
      throw Errors.Validation("Username, password and role are required");
    }

    // Prevent invalid role creation (admin signup not allowed via public route)
    if (!["athlete", "coach"].includes(role)) {
      throw Errors.Forbidden("Invalid registration role");
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existing) throw Errors.Duplicate("Username or email already exists");

    // Institution verification
    let institution = null;
    if (institutionCode) {
      institution = await prisma.institution.findUnique({
        where: { code: institutionCode },
      });
      if (!institution) throw Errors.BadRequest("Invalid institution code");
    } else if (role === "athlete" || role === "coach") {
      throw Errors.Validation("Institution code is required");
    }

    // Coach validation (if coach code entered)
    let coach = null;
    if (coachCode) {
      coach = await prisma.user.findFirst({
        where: { coachCode },
      });
      if (!coach) throw Errors.BadRequest("Invalid coach code");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create User
    const user = await prisma.user.create({
      data: {
        username,
        email,
        name,
        passwordHash,
        role,
        ...(role === "coach" && { coachCode: generateCoachCode() }),
        ...(institution && { institutionId: institution.id }),
      },
    });

    // Role-specific creation logic
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
          approved: false,
        },
      });
    }

    if (role === "coach") {
      await prisma.coachInstitution.create({
        data: {
          coach: { connect: { id: user.id } },
          institution: { connect: { id: institution.id } },
        },
      });
    }

    const tokens = generateTokens(user);
    logger.info(`✅ New ${role} registered: ${username}`);

    res.status(201).json({
      success: true,
      message: "Registration successful (pending approval if required)",
      data: {
        user: sanitizeUser(user),
        ...tokens,
      },
    });
  } catch (err: any) {
    logger.error("❌ Registration failed: " + err.message);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔑 Login
------------------------------------------------------------------------*/
export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      throw Errors.Validation("Username/email and password required");

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      include: { athlete: true },
    });
    if (!user) throw Errors.Auth("Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Errors.Auth("Invalid credentials");

    // Block unapproved athletes
    if (user.role === "athlete" && user.athlete && !user.athlete.approved) {
      throw Errors.Forbidden("Athlete account pending approval by coach/admin");
    }

    const tokens = generateTokens(user);
    logger.info(`🔐 Login success for ${user.username} (${user.role})`);

    res.json({
      success: true,
      message: "Login successful",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (err: any) {
    logger.error("❌ Login failed: " + err.message);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔄 Refresh Token
------------------------------------------------------------------------*/
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
    logger.error("❌ Refresh token failed: " + err.message);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   👤 Me
------------------------------------------------------------------------*/
export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) throw Errors.Auth("Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { athlete: true },
    });

    if (!user) throw Errors.NotFound("User not found");

    res.json({
      success: true,
      data: sanitizeUser(user),
      athleteProfile: user.athlete ?? null,
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚪 Logout
------------------------------------------------------------------------*/
export const logout = async (_req: Request, res: Response) => {
  try {
    // Tokens are stateless (JWT), so logout handled client-side (token deletion)
    res.json({
      success: true,
      message: "Logout successful. Token invalidated on client side.",
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};