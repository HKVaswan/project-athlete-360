// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

/**
 * Utility: create JWT
 */
const createToken = (payload: object) => {
  const secret = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";
  const opts = { expiresIn: "7d" };
  return jwt.sign(payload, secret, opts);
};

/**
 * Build safe user object (no passwordHash, minimal fields)
 */
const safeUserPayload = (user: any) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * Register new user
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    // Basic validation
    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const cleanUsername = String(username).trim();
    const cleanContact = String(contact_info).trim();

    // Check username uniqueness
    const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
    if (existingUser) return res.status(400).json({ success: false, message: "Username already exists" });

    // Check email uniqueness (if any)
    if (cleanContact) {
      const existingEmail = await prisma.user.findUnique({ where: { email: cleanContact } });
      if (existingEmail) return res.status(400).json({ success: false, message: "Email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(String(password), 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanContact || null,
        passwordHash,
        name,
        role: (role as any) || "athlete",
      },
    });

    // Create athlete if role = athlete
    let athlete: any = null;
    if ((role as string) === "athlete") {
      const athleteCode = `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
      athlete = await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode,
          name,
          sport: sport || null,
          dob: dob ? new Date(dob) : null,
          gender: gender || null,
          contactInfo: cleanContact || null,
        },
      });
    }

    const userSafe = safeUserPayload(user);
    logger.info(`Registration success username=${user.username}`);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      user: userSafe,
      athlete,
    });
  } catch (err: any) {
    console.error("❌ Registration failed:", err);
    logger.error("Registration failed: " + (err?.message ?? err));
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate field value" });
    }
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

/**
 * LOGIN
 * Accepts { username } or { email } or { identifier } + password
 * Returns: { access_token, user }
 */
export const login = async (req: Request, res: Response) => {
  try {
    const rawIdentifier = (req.body.username || req.body.email || req.body.identifier || "").toString();
    const password = (req.body.password || "").toString();

    const identifier = rawIdentifier.trim();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }

    logger.info(`[LOGIN] Attempt for identifier="${identifier}"`);

    // Find user by username OR email
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    if (!user) {
      logger.warn(`[LOGIN] No user found for identifier="${identifier}"`);
      return res.status(400).json({ success: false, message: "Incorrect username or password." });
    }

    if (!user.passwordHash) {
      logger.error(`[LOGIN] User ${user.id} has no passwordHash`);
      return res.status(500).json({ success: false, message: "Server error during login" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      logger.warn(`[LOGIN] Invalid password for userId=${user.id}`);
      return res.status(400).json({ success: false, message: "Incorrect username or password." });
    }

    // Create JWT token with minimal claims
    const token = createToken({ sub: user.id, role: user.role });

    const userSafe = safeUserPayload(user);

    logger.info(`[LOGIN] Success for userId=${user.id} username="${user.username}"`);

    // Return token and safe user so frontend can use either/or
    return res.json({
      success: true,
      message: "Login successful",
      access_token: token,
      user: userSafe,
    });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + (err?.message ?? err));
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * ME
 * Returns current user as { user: { ... } }
 * Requires middleware that sets (req as any).userId
 */
export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { athlete: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const userSafe = { ...safeUserPayload(user), athlete: user.athlete || null };

    return res.json({ success: true, user: userSafe });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + (err?.message ?? err));
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
