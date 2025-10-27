// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";
import { Role, InviteStatus } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/** Generate unique athlete or coach codes */
const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
const generateCoachCode = () => `COACH-${Math.floor(1000 + Math.random() * 9000)}`;

/** Sanitize user object before returning to client */
const safeUser = (user: any) => {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    institutionId: user.institutionId ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ───────────────────────────────
// 🧩 REGISTER USER
// ───────────────────────────────
export const register = async (req: Request, res: Response) => {
  try {
    const {
      username,
      password,
      name,
      dob,
      sport,
      gender,
      contact_info,
      institutionCode,
      coachCode,
      invitationCode,
      role,
    } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: "Username, password, and name are required." });
    }

    // Check if user exists
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Username or email already exists." });
    }

    // ───────────────
    // Handle invitation-based registration
    // ───────────────
    let institutionId: string | null = null;
    let invitedByCoach: string | null = null;

    if (invitationCode) {
      const invite = await prisma.invitation.findUnique({
        where: { code: invitationCode },
      });
      if (!invite || invite.status !== InviteStatus.pending) {
        return res.status(400).json({ success: false, message: "Invalid or expired invitation code." });
      }

      institutionId = invite.institutionId ?? null;
      invitedByCoach = invite.senderId;

      // Mark invitation as accepted
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: InviteStatus.accepted, acceptedAt: new Date() },
      });
    }

    // ───────────────
    // Link institution (if provided manually)
    // ───────────────
    if (institutionCode && !institutionId) {
      const institution = await prisma.institution.findUnique({
        where: { code: String(institutionCode) },
      });
      if (!institution) {
        return res.status(400).json({ success: false, message: "Invalid institution code." });
      }
      institutionId = institution.id;
    }

    // ───────────────
    // Link coach (optional)
    // ───────────────
    let coachUser = null;
    if (coachCode) {
      coachUser = await prisma.user.findFirst({
        where: { coachCode: String(coachCode), role: "coach" },
      });
      if (!coachUser) {
        return res.status(400).json({ success: false, message: "Invalid coach code." });
      }
      if (institutionId && coachUser.institutionId && coachUser.institutionId !== institutionId) {
        return res.status(400).json({ success: false, message: "Coach does not belong to that institution." });
      }
      invitedByCoach = coachUser.id;
    }

    // ───────────────
    // Create user
    // ───────────────
    const passwordHash = await bcrypt.hash(password, 10);
    const userRole = (role || Role.athlete) as Role;

    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role: userRole,
        institutionId,
        ...(userRole === Role.coach ? { coachCode: generateCoachCode() } : {}),
      },
    });

    // ───────────────
    // Create athlete profile (for athletes)
    // ───────────────
    let athlete = null;
    if (userRole === Role.athlete) {
      athlete = await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode: generateAthleteCode(),
          name,
          sport,
          dob: dob ? new Date(dob) : null,
          gender,
          contactInfo: contact_info,
          approved: false,
          institutionId: institutionId || null,
        },
      });

      // Optional: send notification to coach or admin for approval (future enhancement)
    }

    // ───────────────
    // JWT Token generation
    // ───────────────
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info(`🆕 Registered new ${userRole}: ${user.username}`);

    return res.status(201).json({
      success: true,
      message: "Registration successful (pending approval if required).",
      access_token: token,
      data: { user: safeUser(user), athlete },
    });
  } catch (err: any) {
    logger.error("❌ Registration failed: " + (err?.message || err));
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate field value." });
    }
    return res.status(500).json({ success: false, message: "Server error during registration." });
  }
};

// ───────────────────────────────
// 🔐 LOGIN USER
// ───────────────────────────────
export const login = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username/email and password required." });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
    });
    if (!user)
      return res.status(400).json({ success: false, message: "Invalid username or password." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(400).json({ success: false, message: "Invalid username or password." });

    // Check athlete approval status
    if (user.role === Role.athlete) {
      const athlete = await prisma.athlete.findUnique({ where: { userId: user.id } });
      if (athlete && !athlete.approved) {
        return res.status(403).json({
          success: false,
          message: "Athlete account pending approval. Please contact your coach.",
        });
      }
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info(`✅ Login success: ${user.username} (${user.role})`);

    return res.json({
      success: true,
      message: "Login successful.",
      access_token: token,
      data: safeUser(user),
    });
  } catch (err: any) {
    logger.error("❌ Login failed: " + (err?.message || err));
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
};

// ───────────────────────────────
// 👤 ME (Authenticated user info)
// ───────────────────────────────
export const me = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, message: "No token provided." });

    const token = authHeader.split(" ")[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { athlete: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    return res.json({
      success: true,
      message: "Authenticated user fetched successfully.",
      data: safeUser(user),
      athlete: user.athlete ?? null,
    });
  } catch (err: any) {
    logger.error("⚠️ Fetching authenticated user failed: " + (err?.message || err));
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};