// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";
import logger from "../logger";

export const register = async (req: Request, res: Response) => {
  try {
    // Log the incoming request body (but hide password for safety)
    const safeBody = { ...req.body, password: "***" };
    console.log("[REGISTER] Incoming body:", JSON.stringify(safeBody, null, 2));

    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    // Validation check
    if (!username || !password || !name || !dob || !gender || !contact_info || !role) {
      console.log("[REGISTER] Validation failed – missing fields");
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existing) {
      console.log("[REGISTER] Existing user found:", existing.id, existing.username, existing.email);
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    console.log("[REGISTER] Creating new user...");
    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash,
        name,
        role,
      },
    });
    console.log("[REGISTER] User created:", user.id);

    // Create athlete if role = athlete
    let athlete: any = null;
    if (role === "athlete") {
      const athleteCode = `ATH-${Math.floor(1000 + Math.random() * 9000)}`;
      console.log("[REGISTER] Creating athlete profile with code:", athleteCode);

      athlete = await prisma.athlete.create({
        data: {
          athleteCode,
          name,
          sport,
          dob: new Date(dob),
          gender,
          contactInfo: contact_info,
          user: { connect: { id: user.id } },
        },
      });
      console.log("[REGISTER] Athlete created:", athlete.id);
    }

    console.log("[REGISTER] ✅ Registration success:", user.username);
    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user, athlete },
    });
  } catch (err: any) {
    // Enhanced diagnostics
    console.error("❌ [REGISTER] Registration failed");
    console.error("Name:", err?.name);
    console.error("Code:", err?.code);
    console.error("Message:", err?.message);
    console.error("Meta:", err?.meta);
    console.error("Stack:", err?.stack);

    logger.error("Registration failed: " + err);

    // Known Prisma duplicate error
    if (err?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    // If table doesn’t exist or DB schema mismatch
    if (err?.message?.includes("does not exist")) {
      return res.status(500).json({
        success: false,
        message: "Database table missing. Run `prisma db push` to sync schema.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "Username and password required" });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ success: false, message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: "Invalid credentials" });

    console.log("[LOGIN] ✅ Login success for user:", username);
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error("[LOGIN] ❌ Login failed:", err);
    logger.error("Login failed: " + err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

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
    console.error("[ME] ❌ Fetching user failed:", err);
    logger.error("Fetching user failed: " + err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
