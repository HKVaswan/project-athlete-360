// src/services/auth.service.ts
/**
 * Auth Service (Enterprise-Grade)
 * --------------------------------
 * - Secure JWT + Refresh token lifecycle
 * - Role-based access (Super Admin isolation)
 * - Device/IP-bound refresh tokens
 * - Structured audit logging
 * - Supports password reset, rotation & revocation
 */

import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, ApiError } from "../utils/errors";
import { sendEmail } from "../utils/email";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refreshsupersecret";
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const REFRESH_TOKEN_BYTES = 48;

/* ────────────────────────────────────── */
/* 🔐 Utility Helpers                    */
/* ────────────────────────────────────── */

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const randomToken = (bytes = REFRESH_TOKEN_BYTES) => crypto.randomBytes(bytes).toString("hex");

export const safeUser = (u: any) =>
  !u
    ? null
    : {
        id: u.id,
        username: u.username,
        email: u.email ?? null,
        name: u.name ?? null,
        role: u.role ?? null,
        institutionId: u.institutionId ?? null,
      };

/* ────────────────────────────────────── */
/* 🔒 Password Validation                 */
/* ────────────────────────────────────── */
export const validatePasswordStrength = (pwd: string) => {
  if (!pwd || pwd.length < 8)
    return { ok: false, reason: "Password must be at least 8 characters long" };
  const hasLetter = /[a-zA-Z]/.test(pwd);
  const hasDigit = /[0-9]/.test(pwd);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pwd);
  if (!hasLetter || !hasDigit || !hasSpecial)
    return {
      ok: false,
      reason: "Password must include letters, numbers, and a special character",
    };
  return { ok: true };
};

/* ────────────────────────────────────── */
/* 🧩 Token Lifecycle                     */
/* ────────────────────────────────────── */
export const generateAccessToken = (payload: {
  userId: string;
  username: string;
  role?: string;
}) => jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });

export const verifyAccessToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw Errors.TokenExpired("Invalid or expired access token");
  }
};

/**
 * Issue refresh token (device/IP aware)
 */
export const issueRefreshToken = async (
  userId: string,
  ip?: string,
  userAgent?: string
) => {
  const token = randomToken();
  const tokenHash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      issuedAt: now,
      expiresAt,
      revoked: false,
      ip,
      userAgent,
    },
  });

  return { token, expiresAt };
};

/**
 * Rotate refresh token securely
 */
export const rotateRefreshToken = async (
  token: string,
  ip?: string,
  userAgent?: string
) => {
  const tokenHash = sha256(token);
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) throw Errors.Auth("Invalid refresh token");
  if (stored.revoked) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revoked: false },
      data: { revoked: true },
    });
    logger.error(`[SECURITY] Replay detected. Revoked all refresh tokens for user=${stored.userId}`);
    throw Errors.PrivilegeViolation("Refresh token replay detected");
  }
  if (stored.expiresAt < new Date()) throw Errors.Auth("Refresh token expired");

  const user = stored.user;
  if (!user) throw Errors.Auth("User not found for refresh token");

  const newToken = randomToken();
  const newHash = sha256(newToken);
  const now = new Date();
  const newExpires = new Date(
    now.getTime() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        issuedAt: now,
        expiresAt: newExpires,
        revoked: false,
        ip,
        userAgent,
      },
    }),
  ]);

  const accessToken = generateAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  return { accessToken, refreshToken: newToken, user: safeUser(user) };
};

/* ────────────────────────────────────── */
/* 👤 Registration                        */
/* ────────────────────────────────────── */
export const registerUser = async (opts: {
  username: string;
  password: string;
  name?: string;
  email?: string;
  role?: "athlete" | "coach" | "admin" | "super_admin";
  dob?: string | null;
  sport?: string | null;
  gender?: string | null;
  institutionId?: string | null;
}) => {
  const { username, password, email, role = "athlete" } = opts;
  if (!username || !password)
    throw Errors.Validation("Username and password are required");

  if (role === "super_admin") {
    throw Errors.PrivilegeViolation("Cannot self-register as Super Admin");
  }

  const pwValidation = validatePasswordStrength(password);
  if (!pwValidation.ok) throw Errors.Validation(pwValidation.reason);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) throw Errors.Duplicate("Username or email already exists");

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      name: opts.name,
      role,
      institutionId: opts.institutionId || undefined,
    },
  });

  const accessToken = generateAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });
  const { token: refreshToken } = await issueRefreshToken(user.id);

  logger.info(`[REGISTER] ${user.username} (${role})`);

  return { user: safeUser(user), accessToken, refreshToken };
};

/* ────────────────────────────────────── */
/* 🔑 Login & Logout                     */
/* ────────────────────────────────────── */
export const loginUser = async (
  identifier: string,
  password: string,
  ip?: string,
  userAgent?: string
) => {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  });
  if (!user) throw Errors.Auth("Invalid username or password");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw Errors.Auth("Invalid username or password");

  if (user.role === "super_admin") {
    logger.info(`[SECURITY] Super Admin login: ${user.username} (${user.id})`, { ip, userAgent });
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });
  const { token: refreshToken } = await issueRefreshToken(user.id, ip, userAgent);

  return { user: safeUser(user), accessToken, refreshToken };
};

export const logoutUser = async (refreshToken?: string, userId?: string) => {
  if (refreshToken) await revokeRefreshToken(refreshToken);
  else if (userId)
    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  logger.info(`[LOGOUT] userId=${userId ?? "unknown"}`);
  return true;
};

/* ────────────────────────────────────── */
/* 🧩 Password Reset Flow                 */
/* ────────────────────────────────────── */
export const startPasswordReset = async (email: string, frontendResetUrl: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw Errors.NotFound("Email not found");

  const resetToken = randomToken();
  const tokenHash = sha256(resetToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt, used: false },
  });

  const resetUrl = `${frontendResetUrl}?token=${resetToken}&email=${encodeURIComponent(email)}`;
  await sendEmail({
    to: email,
    subject: "Password Reset Request",
    html: `<p>Click to reset password: <a href="${resetUrl}">${resetUrl}</a></p>`,
  });

  logger.info(`[PASSWORD RESET INIT] user=${user.username}`);
};

export const completePasswordReset = async (
  email: string,
  token: string,
  newPassword: string
) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw Errors.NotFound("User not found");

  const tokenHash = sha256(token);
  const reset = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, tokenHash, used: false },
  });
  if (!reset) throw Errors.Auth("Invalid or expired reset token");
  if (reset.expiresAt < new Date()) throw Errors.Auth("Reset token expired");

  const pwValidation = validatePasswordStrength(newPassword);
  if (!pwValidation.ok) throw Errors.Validation(pwValidation.reason);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { used: true } }),
  ]);

  logger.info(`[PASSWORD RESET COMPLETE] user=${user.username}`);
  return { success: true };
};