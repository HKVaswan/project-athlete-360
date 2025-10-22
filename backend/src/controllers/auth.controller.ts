import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../prismaClient";

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, name, dob, sport, gender, contact_info, role } = req.body;

    // basic validation (optional)
    if (!username || !password || !name || !dob || !gender || !contact_info) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // hash password
    const hashed = await bcrypt.hash(password, 10);

    // create user
    const user = await prisma.user.create({
      data: {
        username,
        email: contact_info,
        passwordHash: hashed,
        name,
        role,
      },
    });

    // if athlete, create athlete profile
    if (role === "athlete") {
      await prisma.athlete.create({
        data: {
          athleteCode: `ATH-${Math.floor(Math.random() * 10000)}`, // unique code
          name,
          sport,
          dob: new Date(dob),
          gender,
          contactInfo: contact_info,
          user: { connect: { id: user.id } }, // ✅ link user
        },
      });
    }

    res.status(201).json({ success: true, message: "Registration successful", userId: user.id });
  } catch (err: any) {
    console.error("Registration error:", err);

    // Prisma unique constraint error (username/email)
    if (err.code === "P2002") {
      return res.status(400).json({ success: false, message: "Username or email already exists" });
    }

    res.status(500).json({ success: false, message: "Registration failed" });
  }
};
