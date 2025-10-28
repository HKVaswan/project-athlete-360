// src/services/user.service.ts
/**
 * User Service
 * -------------------------------------------------
 * Handles all user management operations:
 *  - Fetching users (with search, filter, pagination)
 *  - Updating profiles and passwords
 *  - Admin actions (suspend, delete, role changes)
 *  - Future-ready hooks for audit logging and analytics
 */

import prisma from "../prismaClient";
import bcrypt from "bcrypt";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate } from "../utils/pagination";
import { validatePasswordStrength } from "./auth.service";

const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

/**
 * Get a single user by ID with basic safety
 */
export const getUserById = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { institution: true },
  });
  if (!user) throw Errors.NotFound("User not found");

  return sanitizeUser(user);
};

/**
 * Get all users with pagination and optional search/filter
 */
export const getAllUsers = async (query: any) => {
  const where: any = {};

  if (query.search) {
    const s = String(query.search).trim();
    where.OR = [
      { username: { contains: s, mode: "insensitive" } },
      { name: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
    ];
  }

  if (query.role) {
    where.role = query.role;
  }

  if (query.institutionId) {
    where.institutionId = query.institutionId;
  }

  const { prismaArgs, meta } = await paginate(query, "offset", {
    countFn: (where) => prisma.user.count({ where }),
    where,
    includeTotal: true,
  });

  const users = await prisma.user.findMany({
    ...prismaArgs,
    where,
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      institutionId: true,
      institution: {
        select: { id: true, name: true },
      },
    },
  });

  return { data: users, meta };
};

/**
 * Update user profile (self or admin)
 */
export const updateUserProfile = async (
  userId: string,
  updates: {
    name?: string;
    email?: string;
    username?: string;
    institutionId?: string | null;
  },
  actorId?: string // who performed the update
) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw Errors.NotFound("User not found");

  // basic validations
  if (updates.username && updates.username !== existing.username) {
    const taken = await prisma.user.findUnique({ where: { username: updates.username } });
    if (taken) throw Errors.Duplicate("Username already taken");
  }

  if (updates.email && updates.email !== existing.email) {
    const taken = await prisma.user.findUnique({ where: { email: updates.email } });
    if (taken) throw Errors.Duplicate("Email already in use");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: updates.name ?? existing.name,
      email: updates.email ?? existing.email,
      username: updates.username ?? existing.username,
      institutionId: updates.institutionId ?? existing.institutionId,
    },
  });

  // Audit logging (future integration with audit log system)
  logger.info(`User ${userId} updated by ${actorId || userId}`);

  return sanitizeUser(user);
};

/**
 * Change password (self or admin-triggered reset)
 */
export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  actorId?: string
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.NotFound("User not found");

  const isSelf = actorId === userId || !actorId;

  if (isSelf) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw Errors.Auth("Current password incorrect");
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) throw Errors.Validation(pwCheck.reason);

  const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  logger.info(`Password changed for user ${user.username} by ${actorId || "self"}`);

  return { success: true };
};

/**
 * Admin: Suspend user (soft lock)
 */
export const suspendUser = async (userId: string, reason = "Suspended by admin") => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.NotFound("User not found");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { suspended: true, suspensionReason: reason },
  });

  logger.warn(`User ${user.username} suspended. Reason: ${reason}`);

  return sanitizeUser(updated);
};

/**
 * Admin: Reactivate user
 */
export const reactivateUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.NotFound("User not found");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { suspended: false, suspensionReason: null },
  });

  logger.info(`User ${user.username} reactivated`);
  return sanitizeUser(updated);
};

/**
 * Delete user (admin or self)
 *  - Revokes tokens
 *  - Cascades athlete profile if exists
 */
export const deleteUser = async (userId: string, actorId?: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.NotFound("User not found");

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.athlete.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  logger.warn(`User ${user.username} deleted by ${actorId || "self"}`);

  return { success: true };
};

/**
 * Utility: Safe user serializer for responses
 */
const sanitizeUser = (user: any) => {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
};

/**
 * Optional: Bulk import users (future enterprise feature)
 * - For onboarding institutions or large-scale integrations
 */
export const bulkImportUsers = async (users: any[], institutionId?: string) => {
  const results: { success: boolean; username: string; reason?: string }[] = [];

  for (const u of users) {
    try {
      const pw = u.password || crypto.randomBytes(6).toString("hex");
      const hash = await bcrypt.hash(pw, BCRYPT_SALT_ROUNDS);
      await prisma.user.create({
        data: {
          username: u.username,
          email: u.email,
          passwordHash: hash,
          role: u.role || "athlete",
          name: u.name || u.username,
          institutionId,
        },
      });
      results.push({ success: true, username: u.username });
    } catch (err: any) {
      results.push({ success: false, username: u.username, reason: err.message });
    }
  }

  logger.info(`Bulk imported ${results.filter((r) => r.success).length}/${users.length} users`);

  return results;
};