import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

/**
 * Register new user
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // ✅ Check if username already exists
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Username already exists" });
    }

    // ✅ Check if email already exists only if provided
    if (contact_info) {
      const existingEmail = await prisma.user.findUnique({ where: { email: contact_info } });
      if (existingEmail) {
        return res.status(400).json({ success: false, message: "Email already exists" });
      }
    }

    // ✅ Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ Create user
    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role: role || "athlete",
      },
    });

    // ✅ Create athlete profile if role = athlete
    let athlete: any = null;
    if (role === "athlete") {
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
      data: { user, athlete },
    });
  } catch (err: any) {
    console.error("❌ Registration failed:", err);
    logger.error("Registration failed: " + err.message);
    if (err.code === "P2002") {
      return res.status(400).json({ success: false, message: "Duplicate field value" });
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

    const identifier = username || email;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username/Email and password required" });
    }

    // ✅ Allow login via username OR email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
        ],
      },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid username/email or password" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid username/email or password" });
    }

    // ✅ Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      access_token: token,
    });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + err.message);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * Get current user info
 */
export const me = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, message: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { athlete: true },
    });

    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, user });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
