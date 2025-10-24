// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";
import logger from "../logger";

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

    // Trim inputs to avoid accidental whitespace issues
    const cleanUsername = String(username).trim();
    const cleanEmail = String(contact_info).trim();

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Username already exists" });
    }

    // If contact_info looks like an email or is provided, check email uniqueness
    if (cleanEmail) {
      const existingEmail = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existingEmail) {
        return res.status(400).json({ success: false, message: "Email already exists" });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(String(password), 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanEmail || null,
        passwordHash,
        name,
        role: (role as any) || "athlete",
      },
    });

    // Create athlete profile if role = athlete
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
          contactInfo: cleanEmail || null,
        },
      });
    }

    // Return safe user (do not return passwordHash)
    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    logger.info(`Registration success for username=${user.username}`);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user: safeUser, athlete },
    });
  } catch (err: any) {
    console.error("❌ Registration failed:", err);
    logger.error("Registration failed: " + (err?.message ?? err));

    if (err?.code === "P2002") {
      // Prisma unique constraint failure
      return res.status(400).json({ success: false, message: "Duplicate field value" });
    }

    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

/**
 * Login existing user
 * Accepts: { username, password } or { email, password } or { identifier, password }
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

    // Find by username or email
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

    logger.info(`[LOGIN] Success for userId=${user.id} username="${user.username}"`);

    // Return safe user payload
    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return res.json({ success: true, message: "Login successful", data: safeUser });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + (err?.message ?? err));
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * Get current user details (requires middleware to set req.userId)
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

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      athlete: user.athlete || null,
    };

    return res.json({ success: true, data: safeUser });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + (err?.message ?? err));
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
