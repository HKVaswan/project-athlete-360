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

    // ✅ Basic validation
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
    let athlete = null;
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
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "Username and password required" });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user)
      return res.status(400).json({ success: false, message: "Invalid username or password" });

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid)
      return res.status(400).json({ success: false, message: "Invalid username or password" });

    return res.json({
      success: true,
      message: "Login successful",
      data: user,
    });
  } catch (err: any) {
    console.error("❌ Login failed:", err);
    logger.error("Login failed: " + err.message);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

/**
 * Get user details
 */
export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { athlete: true },
    });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err: any) {
    console.error("❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
