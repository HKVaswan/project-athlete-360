// src/controllers/users.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import logger from "../logger";
import * as userService from "../services/user.service";

const prisma = new PrismaClient();

// ─────────────────────────────
// ADMIN: List all users
export async function getAllUsers(req: Request, res: Response) {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: users });
}

// ─────────────────────────────
// ADMIN: Get user by ID
export async function getUserById(req: Request, res: Response) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, email: true, role: true, name: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ success: true, data: user });
}

// ─────────────────────────────
// ADMIN: Update user role or details
export async function updateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { name, role } = req.body;
  const updated = await prisma.user.update({
    where: { id },
    data: { name, role },
  });
  return res.json({ success: true, data: updated });
}

// ─────────────────────────────
// ADMIN: Delete user
export async function deleteUser(req: Request, res: Response) {
  const { id } = req.params;
  await prisma.user.delete({ where: { id } });
  logger.info(`User ${id} deleted by admin`);
  return res.json({ success: true, message: "User deleted" });
}

// ─────────────────────────────
// GET own profile
export async function getProfile(req: Request, res: Response) {
  const { id } = req.params;
  const user = await userService.getUserProfile(id);
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ success: true, data: user });
}

// ─────────────────────────────
// UPDATE own profile
export async function updateProfile(req: Request, res: Response) {
  const { id } = req.params;
  const { name, email } = req.body;
  const updated = await prisma.user.update({
    where: { id },
    data: { name, email },
  });
  return res.json({ success: true, data: updated });
}

// ─────────────────────────────
// UPDATE password
export async function updatePassword(req: Request, res: Response) {
  const { id } = req.params;
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ message: "Both old and new passwords are required" });

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ message: "User not found" });

  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ message: "Incorrect old password" });

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id },
    data: { passwordHash: newHash },
  });
  logger.info(`User ${id} updated password`);
  return res.json({ success: true, message: "Password updated successfully" });
}
