/**
 * src/utils/crypto.ts
 * -------------------------------------------------------
 * Handles all encryption, hashing, and token operations.
 * Uses bcrypt for passwords, crypto for tokens,
 * and JWT for authentication tokens.
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import config from "../config";

const SALT_ROUNDS = 12;

/* -------------------------------------------------------------------------- */
/* 🧂 PASSWORD HASHING                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Hash user password using bcrypt.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
};

/**
 * Compare raw password with hashed password.
 */
export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/* -------------------------------------------------------------------------- */
/* 🔐 TOKEN (RANDOM STRING) GENERATION                                        */
/* -------------------------------------------------------------------------- */

/**
 * Generate secure random token (for password reset, invitations, etc.)
 */
export const generateRandomToken = (length = 48): string => {
  return crypto.randomBytes(length).toString("hex");
};

/**
 * Hash token for safe storage (e.g., refresh token hashes in DB)
 */
export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/* -------------------------------------------------------------------------- */
/* 🔑 JWT UTILS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Generate signed JWT access token.
 */
export const generateAccessToken = (payload: object): string => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn || "15m",
    algorithm: "HS256",
  });
};

/**
 * Generate signed JWT refresh token.
 */
export const generateRefreshToken = (payload: object): string => {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn || "7d",
    algorithm: "HS256",
  });
};

/**
 * Verify JWT safely and return payload or null.
 */
export const verifyJwt = (token: string, isRefresh = false): JwtPayload | null => {
  try {
    const secret = isRefresh ? config.jwt.refreshSecret : config.jwt.secret;
    return jwt.verify(token, secret) as JwtPayload;
  } catch (err) {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* 🧠 ENCRYPTION / DECRYPTION (Optional Layer)                                */
/* -------------------------------------------------------------------------- */

/**
 * AES-256-GCM encryption for sensitive fields (optional, advanced use).
 */
const ALGO = "aes-256-gcm";
const IV_LENGTH = 16;

export const encrypt = (data: string, secret: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, crypto.scryptSync(secret, "salt", 32), iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
};

export const decrypt = (encryptedData: string, secret: string): string => {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, crypto.scryptSync(secret, "salt", 32), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};