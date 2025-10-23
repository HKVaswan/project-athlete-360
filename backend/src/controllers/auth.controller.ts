// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";
import logger from "../logger";
import { generateToken } from "../utils/jwt"; // if you have this; otherwise remove token generation

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password || !name || !dob || !gender || !contact_info || !role) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existing) return res.status(400).json({ success: false, message: "Username or email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role,
      },
    });

    let athlete = null;
    if (role === "athlete") {
      athlete = await prisma.athlete.create({
        data: {
          athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
          name,
          sport,
          dob: new Date(dob),
          gender,
          contactInfo: contact_info,
          user: { connect: { id: user.id } },
        },
      });
    }

    // optional: create token if you use JWT utils
    let token = null;
    try {
      if (typeof generateToken === "function") token = generateToken({ userId: user.id, role: user.role });
    } catch (e) {
      // ignore token generation errors
    }

    return res.status(201).json({ success: true, message: "Registration successful", data: { user, athlete }, token });
  } catch (err: any) {
    logger.error("Registration failed: " + err);
    if (err?.code === "P2002") return res.status(400).json({ success: false, message: "Username or email already exists" });
    return res.status(500).json({ success: false, message: "Server error during registration" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Username and password required" });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ success: false, message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: "Invalid credentials" });

    let token = null;
    try {
      if (typeof generateToken === "function") token = generateToken({ userId: user.id, role: user.role });
    } catch {}

    return res.json({ success: true, data: user, token });
  } catch (err) {
    logger.error("Login failed: " + err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { athlete: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err) {
    logger.error("Fetching user failed: " + err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};