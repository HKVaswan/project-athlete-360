import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

/**
 * Helper: build a minimal user object to return to client
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
 * Register new user
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // check username
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Username already exists" });
    }

    // check email if provided
    if (contact_info) {
      const existingEmail = await prisma.user.findUnique({ where: { email: contact_info } });
      if (existingEmail) {
        return res.status(400).json({ success: false, message: "Email already exists" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role: role || "athlete",
      },
    });

    let athlete: any = null;
    if ((role || "athlete") === "athlete") {
      const athleteCode = `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
      athlete = await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode,
          name,
          sport,
          dob: new Date(dob),
          gender,
          contactInfo: contact_info,
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user: safeUser(user), athlete },
    });
  } catch (err: any) {
    console.error("❌ Registration failed:", err);
    logger.error("Registration failed: " + (err?.message || err));
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate field value" });
    }
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

/**
 * Login existing user (accepts username OR email).
 * Returns access_token AND the minimal user object (so frontend can skip /me).
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

    if (!user) {
      // don't leak whether username or email exists
      return res.status(400).json({ success: false, message: "Invalid username or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ success: false, message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Log login success (helps debugging)
    console.log(`[LOGIN] success for: ${user.username} (${user.id})`);

    return res.json({
      success: true,
      message: "Login successful",
      access_token: token,
      user: safeUser(user),   // include minimal user so frontend can skip /me
    });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + (err?.message || err));
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * Get current user info (verifies token). Returns both `user` and `data` keys
 * so client code that expects either will work.
 */
export const me = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

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

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // return both shapes (user & data) to be tolerant with frontend expectations
    return res.json({
      success: true,
      message: "Fetched user",
      user: safeUser(user),
      data: safeUser(user),
    });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + (err?.message || err));
    return res.status(500).json({ success: false, message: "Server error while fetching user" });
  }
};
