import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

/**
 * Helper: minimal user object to return to client
 */
const safeUser = (user: any) => {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
  };
};

/**
 * Register new user (idempotent & safe)
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    // Basic validation
    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Ensure username/email unique (race possible, handled later)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role: role || "athlete",
      },
    });

    // If role is athlete, upsert athlete record (safe for duplicates / idempotent)
    let athlete: any = null;
    if ((role || "athlete") === "athlete") {
      const athleteCode = `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

      // Upsert by unique userId to avoid duplicate-key errors
      athlete = await prisma.athlete.upsert({
        where: { userId: user.id }, // userId is UNIQUE in schema
        update: {
          name,
          sport,
          dob: dob ? new Date(dob) : null,
          gender,
          contactInfo: contact_info,
        },
        create: {
          userId: user.id,
          athleteCode,
          name,
          sport,
          dob: dob ? new Date(dob) : null,
          gender,
          contactInfo: contact_info,
        },
      });
    }

    // Return safe response
    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user: safeUser(user), athlete },
    });
  } catch (err: any) {
    console.error("❌ Registration failed:", err);
    logger.error("Registration failed: " + (err?.message || err));

    // Prisma duplicate unique error
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate value exists" });
    }

    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

/**
 * Login existing user
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username/email and password required" });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    if (!user) return res.status(400).json({ success: false, message: "Invalid username or password" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: "Invalid username or password" });

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    console.log(`[LOGIN] success for: ${user.username} (${user.id})`);

    return res.json({
      success: true,
      message: "Login successful",
      access_token: token,
      user: safeUser(user),
    });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + (err?.message || err));
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * Get current user info (verify token)
 */
export const me = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ success: false, message: "Invalid authorization format" });
    }

    const token = parts[1];
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr: any) {
      console.error("❌ JWT verify error:", jwtErr);
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { athlete: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, message: "Fetched user", user: safeUser(user), data: safeUser(user) });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + (err?.message || err));
    return res.status(500).json({ success: false, message: "Server error while fetching user" });
  }
};