import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function register(req: Request, res: Response) {
  const { username, password, name, email, role } = req.body;
  if (!username || !password || password.length < 6) return res.status(400).json({ message: "Invalid input" });

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ message: "Username exists" });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, passwordHash: hash, name, email, role: role || "athlete" }
  });

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET as string, { expiresIn: process.env.JWT_EXPIRES_IN || "1h" });

  res.status(201).json({ access_token: token, user: { id: user.id, username: user.username, role: user.role } });
}

export async function login(req: Request, res: Response) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Missing credentials" });

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET as string, { expiresIn: process.env.JWT_EXPIRES_IN || "1h" });
  res.json({ access_token: token, user: { id: user.id, username: user.username, role: user.role } });
}

export async function me(req: Request & { user?: any }, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ message: "User not found" });

  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt } });
}
