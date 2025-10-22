// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";
import logger from "../logger";
import { generateToken } from "../utils/jwt"; // assume you have a helper to generate JWTs

// ───────────────────────────────
// Register
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password || !name || !dob || !gender || !contact_info || !role) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // check if username/email already exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // create user
    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role,
      },
    });

    // if role is athlete, create linked athlete profile
    let athlete = null;
    if (role === "athlete") {
      athlete = await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`, // unique code
          name,
          dob: new Date(dob),
          sport,
          gender,
          contactInfo: contact_info,
        },
      });
    }

    const token = generateToken({ userId: user.id, role: user.role });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user, athlete },
      token,
    });
  } catch (err) {
    logger.error("Registration failed: " + err);
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

// ───────────────────────────────
// Login
export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Username and password required" });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ success: false, message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: "Invalid credentials" });

    const token = generateToken({ userId: user.id, role: user.role });

    return res.json({ success: true, data: user, token });
  } catch (err) {
    logger.error("Login failed: " + err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

// ───────────────────────────────
// Get current user
export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { athlete: true },
    });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err) {
    logger.error("Fetching user failed: " + err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
