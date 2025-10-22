import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { Secret } from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// REGISTER
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, email, role } = req.body;

    if (!username || !password || password.length < 6) {
      return res.status(400).json({ message: "Invalid input" });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ message: "Username already exists" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: hash,
        name,
        email,
        role: role || "athlete",
      },
    });

    const secret: Secret = process.env.JWT_SECRET || "default_secret";
    const expiresIn: any = process.env.JWT_EXPIRES_IN || "1h";

    const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn });

    return res.status(201).json({
      access_token: token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    logger.error("Registration failed: " + err);
    res.status(500).json({ message: "Failed to register user" });
  }
};

// ───────────────────────────────
// LOGIN
export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const secret: Secret = process.env.JWT_SECRET || "default_secret";
    const expiresIn: any = process.env.JWT_EXPIRES_IN || "1h";

    const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn });

    return res.json({
      access_token: token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    logger.error("Login failed: " + err);
    res.status(500).json({ message: "Failed to login" });
  }
};

// ───────────────────────────────
// CURRENT USER ("me")
export const me = async (req: Request & { user?: any }, res: Response) => {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error("Failed to fetch user: " + err);
    res.status(500).json({ message: "Failed to fetch user data" });
  }
};