// src/services/auth.service.ts
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, ApiError } from "../utils/errors";
import { sendEmail } from "../utils/email";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refreshsupersecret";
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"; // e.g. "7d" or "1h"
const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30); // days

// Hard limits
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const REFRESH_TOKEN_BYTES = 48; // bytes for token entropy

type UserSafe = {
  id: string;
  username: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  institutionId?: string | null;
};

/* ---------------------------
 * Helper utilities
 * --------------------------- */
const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const generateRandomToken = (bytes = REFRESH_TOKEN_BYTES) =>
  crypto.randomBytes(bytes).toString("hex");

/* Build safe user object for responses */
const safeUser = (u: any): UserSafe | null => {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    name: u.name ?? null,
    role: u.role ?? null,
    institutionId: u.institutionId ?? null,
  };
};

/* Validate password strength (adjust rules to taste) */
export const validatePasswordStrength = (pwd: string) => {
  if (!pwd || pwd.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters long" };
  }
  // must contain letters and numbers - change to stronger rules if needed
  const hasLetter = /[a-zA-Z]/.test(pwd);
  const hasDigit = /[0-9]/.test(pwd);
  if (!hasLetter || !hasDigit) {
    return { ok: false, reason: "Password must include letters and numbers" };
  }
  return { ok: true };
};

/* ---------------------------
 * Token creation & verification
 * --------------------------- */
export const generateAccessToken = (payload: { userId: string; username: string; role?: string }) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
};

export const verifyAccessToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch (err) {
    throw Errors.Auth("Invalid or expired access token");
  }
};

/**
 * Create refresh token string, store hashed version in DB
 * Returns { token, expiresAt }
 */
export const createRefreshToken = async (userId: string) => {
  const token = generateRandomToken();
  const tokenHash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  // store in DB
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      issuedAt: now,
      expiresAt,
      revoked: false,
    },
  });

  return { token, expiresAt };
};

/**
 * Revoke refresh token by token string (hash match)
 */
export const revokeRefreshToken = async (token: string) => {
  const tokenHash = sha256(token);
  const updated = await prisma.refreshToken.updateMany({
    where: { tokenHash, revoked: false },
    data: { revoked: true },
  });
  logger.debug(`Revoked refresh tokens (matching hash): ${updated.count}`);
  return updated.count > 0;
};

/**
 * Validate and rotate refresh token:
 * - Accepts raw refresh token string
 * - Finds hashed record, checks expiry and revoked flag
 * - Rotates by revoking old token and issuing new one
 * - Returns { accessToken, refreshToken }
 */
export const rotateRefreshToken = async (token: string) => {
  const tokenHash = sha256(token);

  // Find token
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) {
    throw Errors.Auth("Invalid refresh token");
  }
  if (stored.revoked) {
    // security: revoke all tokens for user if token was replayed
    await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revoked: false }, data: { revoked: true } });
    logger.warn(`Refresh token replay detected for user ${stored.userId}. All tokens revoked.`);
    throw Errors.Auth("Refresh token revoked");
  }
  if (stored.expiresAt < new Date()) {
    throw Errors.Auth("Refresh token expired");
  }

  const user = stored.user;
  if (!user) throw Errors.Auth("User not found for refresh token");

  // rotate: revoke this token, create new one (in transaction)
  const newToken = generateRandomToken();
  const newHash = sha256(newToken);
  const now = new Date();
  const newExpires = new Date(now.getTime() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } }),
    prisma.refreshToken.create({ data: { userId: user.id, tokenHash: newHash, issuedAt: now, expiresAt: newExpires, revoked: false } }),
  ]);

  const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role });

  return {
    accessToken,
    refreshToken: newToken,
    user: safeUser(user),
  };
};

/* ---------------------------
 * Auth workflows
 * --------------------------- */

/**
 * Register a user (and optional athlete profile)
 * - Performs uniqueness checks
 * - Hashes password
 * - Creates user row and athlete if role === 'athlete'
 * - Returns safe user + access token + refresh token (if desired)
 */
export const registerUser = async (opts: {
  username: string;
  password: string;
  name?: string;
  email?: string;
  role?: "athlete" | "coach" | "admin";
  dob?: string | null;
  sport?: string | null;
  gender?: string | null;
  institutionId?: string | null;
}) => {
  const { username, password, name, email, role = "athlete", dob, sport, gender, institutionId } = opts;

  // basic validation
  if (!username || !password) throw Errors.Validation("username and password are required");

  const pwValidation = validatePasswordStrength(password);
  if (!pwValidation.ok) throw Errors.Validation(pwValidation.reason);

  // check uniqueness
  const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
  if (existing) throw Errors.Duplicate("Username or email already exists");

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // use transaction to create user and optional athlete
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username,
        email,
        passwordHash,
        name,
        role,
        institutionId: institutionId || undefined,
      },
    });

    let athlete = null;
    if (role === "athlete") {
      athlete = await tx.athlete.create({
        data: {
          userId: user.id,
          athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
          name: name || username,
          dob: dob ? new Date(dob) : undefined,
          sport: sport || undefined,
          gender: gender || undefined,
          contactInfo: email || undefined,
          approved: false,
          institutionId: institutionId || undefined,
        },
      });
    }

    return { user, athlete };
  });

  // generate tokens for immediate sign-in (optional)
  const accessToken = generateAccessToken({ userId: result.user.id, username: result.user.username, role: result.user.role });
  const { token: refreshToken } = await createRefreshToken(result.user.id);

  // optionally send welcome / notify coach for approval using email util
  try {
    if (role === "athlete" && institutionId) {
      // find admins/coaches to notify (best-effort)
      const admins = await prisma.user.findMany({ where: { institutionId, role: "admin" } });
      if (admins.length > 0) {
        const adminEmails = admins.map((a) => a.email).filter(Boolean) as string[];
        if (adminEmails.length) {
          await sendEmail({
            to: adminEmails,
            subject: `New athlete registration: ${result.athlete?.name || result.user.username}`,
            html: `<p>${result.athlete?.name || result.user.username} has registered and requires approval.</p>`,
          }).catch((e) => logger.warn("Failed to send registration notification:", e));
        }
      }
    }
  } catch (e) {
    logger.warn("Post-registration notification failed:", e);
  }

  logger.info(`User registered: ${result.user.username} (${result.user.id}) role=${result.user.role}`);

  return {
    user: safeUser(result.user),
    athlete: result.athlete,
    accessToken,
    refreshToken,
  };
};

/**
 * Login user
 * - Accepts username or email and password
 * - Ensures athlete approval if role === 'athlete'
 * - Returns access + refresh tokens and safe user
 */
export const loginUser = async (identifier: string, password: string) => {
  if (!identifier || !password) throw Errors.Validation("identifier and password are required");

  const user = await prisma.user.findFirst({ where: { OR: [{ username: identifier }, { email: identifier }] } });
  if (!user) throw Errors.Auth("Invalid username or password");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw Errors.Auth("Invalid username or password");

  // If athlete, ensure approved
  if (user.role === "athlete") {
    const athlete = await prisma.athlete.findUnique({ where: { userId: user.id } });
    if (athlete && athlete.approved === false) {
      throw new ApiError(403, "Athlete account pending approval", "FORBIDDEN");
    }
  }

  const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role });
  const { token: refreshToken } = await createRefreshToken(user.id);

  logger.info(`[LOGIN] ${user.username} (${user.role})`);

  return {
    user: safeUser(user),
    accessToken,
    refreshToken,
  };
};

/**
 * Logout: revoke provided refresh token (best-effort)
 */
export const logout = async (refreshToken?: string, userId?: string) => {
  if (refreshToken) {
    await revokeRefreshToken(refreshToken).catch((e) => logger.warn("Failed to revoke refresh token:", e));
  } else if (userId) {
    await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }).catch((e) => logger.warn("Failed to revoke user's refresh tokens:", e));
  }
  logger.info(`User logout processed (userId=${userId ?? "unknown"})`);
  return true;
};

/**
 * Start password reset flow:
 * - Creates a password-reset token (stored as refreshToken row type or separate mechanism)
 * - Sends email with reset link (uses email util)
 */
export const startPasswordReset = async (email: string, frontendResetUrlBase: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw Errors.NotFound("Email not found");

  const resetToken = generateRandomToken();
  const tokenHash = sha256(resetToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  // We reuse refreshToken model as token store (revoked=false) but mark tokenHash differently
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      issuedAt: new Date(),
      expiresAt,
      revoked: false,
    },
  });

  const resetUrl = `${frontendResetUrlBase}?token=${resetToken}&email=${encodeURIComponent(email)}`;

  try {
    await sendEmail({
      to: email,
      subject: "Password reset request",
      html: `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
    });
  } catch (e) {
    logger.warn("Failed to send password reset email:", e);
  }

  return { success: true };
};

/**
 * Complete password reset using token and new password
 */
export const completePasswordReset = async (email: string, token: string, newPassword: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw Errors.NotFound("User not found");

  const tokenHash = sha256(token);

  // Find matching (non-revoked) token
  const stored = await prisma.refreshToken.findFirst({ where: { tokenHash, userId: user.id, revoked: false } });
  if (!stored) throw Errors.Auth("Invalid or expired reset token");
  if (stored.expiresAt < new Date()) throw Errors.Auth("Reset token expired");

  const pwValidation = validatePasswordStrength(newPassword);
  if (!pwValidation.ok) throw Errors.Validation(pwValidation.reason);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, tokenHash }, data: { revoked: true } }),
  ]);

  logger.info(`Password reset for user ${user.username}`);

  return { success: true };
};