// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

/** Helper: sanitize user object for responses */
const safeUser = (user: any) => {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Check username/email uniqueness
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
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

    // Optionally sign a token on registration (handy for auto-login)
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      access_token: token,
      data: { user: safeUser(user), athlete },
    });
  } catch (err: any) {
    logger.error("Registration failed: " + (err?.message || err));
    console.error("Registration error:", err);
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate field value" });
    }
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    // Accept either username OR email field
    const { username, email, password } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username/email and password required" });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid username or password" });
    }

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
      data: safeUser(user),
      user: safeUser(user), // include both shapes for frontend tolerance
    });
  } catch (err: any) {
    logger.error("Login failed: " + (err?.message || err));
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    // Expect requireAuth middleware to have set req.userId
    const userId = (req as any).userId;
    if (!userId) {
      // As a fallback, try to read/verify token directly
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });
      const token = authHeader.split(" ")[1];
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        (req as any).userId = decoded.userId;
      } catch (err) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: (req as any).userId },
      include: { athlete: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({
      success: true,
      message: "Fetched user",
      data: safeUser(user),
      user: safeUser(user),
    });
  } catch (err: any) {
    logger.error("Fetching user failed: " + (err?.message || err));
    console.error("Me error:", err);
    return res.status(500).json({ success: false, message: "Server error while fetching user" });
  }
};