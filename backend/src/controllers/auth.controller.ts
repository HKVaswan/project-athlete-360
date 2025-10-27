import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const generateAthleteCode = () => `ATH-${Math.floor(1000 + Math.random() * 9000)}`;

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
    institutionId: user.institutionId ?? null,
  };
};

export const register = async (req: Request, res: Response) => {
  try {
    const {
      username,
      password,
      name,
      dob,
      sport,
      gender,
      contact_info,
      institutionCode,
      coachCode,
      role,
    } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // check username or email uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: contact_info }] },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    // resolve institution (if provided)
    let institutionId: string | null = null;
    if (institutionCode) {
      const inst = await prisma.institution.findUnique({ where: { institutionCode: String(institutionCode) } });
      if (!inst) {
        return res.status(400).json({ success: false, message: "Invalid institution code" });
      }
      institutionId = inst.id;
    }

    // resolve coach (optional)
    let coachUser: any = null;
    if (coachCode) {
      coachUser = await prisma.user.findFirst({ where: { coachCode: String(coachCode), role: "coach" } });
      if (!coachUser) {
        return res.status(400).json({ success: false, message: "Invalid coach code" });
      }
      // optional institution consistency check
      if (institutionId && coachUser.institutionId !== institutionId) {
        return res.status(400).json({ success: false, message: "Coach does not belong to that institution" });
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
        ...(institutionId ? { institution: { connect: { id: institutionId } } } : {}),
      },
    });

    // create athlete record when registering as athlete
    let athlete: any = null;
    if ((role || "athlete") === "athlete") {
      athlete = await prisma.athlete.create({
        data: {
          userId: user.id,
          athleteCode: generateAthleteCode(),
          name,
          sport,
          dob: dob ? new Date(dob) : null,
          gender,
          contactInfo: contact_info,
          approved: false, // pending approval by coach/admin
          institutionId: institutionId,
        },
      });
    }

    // optionally create token to allow immediate sign-in attempt
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // TODO: Send notification to coach if coachUser exists (email/push) to approve

    return res.status(201).json({
      success: true,
      message: "Registration successful. Pending approval if required.",
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
    const { username, email, password } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Username/email and password required" });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
    });

    if (!user) return res.status(400).json({ success: false, message: "Invalid username or password" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: "Invalid username or password" });

    // If this user is an athlete, ensure associated athlete is approved (or allow admins/coaches)
    if (user.role === "athlete") {
      const athlete = await prisma.athlete.findUnique({ where: { userId: user.id } });
      if (athlete && athlete.approved === false) {
        // allow admin/coach login as usual; but prevent athlete access until approved
        return res.status(403).json({ success: false, message: "Athlete account pending approval" });
      }
    }

    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    console.log(`[LOGIN] success for: ${user.username} (${user.id})`);

    return res.json({
      success: true,
      message: "Login successful",
      access_token: token,
      data: safeUser(user),
      user: safeUser(user),
    });
  } catch (err: any) {
    logger.error("Login failed: " + (err?.message || err));
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
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