// src/utils/crypto.ts
/**
 * 🔐 Secure cryptographic utilities
 * -----------------------------------
 *  - Handles password hashing & comparison
 *  - Secure random string / token generation
 *  - Hashing of refresh tokens (to prevent token theft)
 *  - Built for scalability and compliance (OWASP standards)
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";

// Recommended bcrypt salt rounds (tunable for performance)
const SALT_ROUNDS = 12;

/**
 * Securely hash a password using bcrypt.
 * @param password - plaintext password
 * @returns Promise<string> - bcrypt hash
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare a plaintext password with its hashed version.
 * @returns boolean - true if valid, false otherwise
 */
export const comparePassword = async (
  password: string,
  hashed: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashed);
};

/**
 * Generate a secure random string (used for API keys, tokens, etc.)
 * @param length - length of bytes (default 32)
 * @returns hex string (length * 2)
 */
export const generateSecureToken = (length = 32): string => {
  return crypto.randomBytes(length).toString("hex");
};

/**
 * Hash a refresh token securely before storing (defense-in-depth).
 * Even if DB leaks, tokens remain useless.
 */
export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Verify whether two tokens (hashed and plain) match safely.
 */
export const verifyHashedToken = (token: string, hashedToken: string): boolean => {
  const computed = hashToken(token);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hashedToken));
};

/**
 * Generate a short random unique identifier (e.g. for athlete/institution codes)
 * Uses Base62 encoding for compactness and URL-safety.
 */
export const generateUniqueId = (prefix = "", length = 8): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return prefix ? `${prefix}-${result}` : result;
};

/**
 * Encrypt & Decrypt small payloads (optional, for sensitive short data)
 * - Uses AES-256-GCM for modern authenticated encryption.
 */
const ALGO = "aes-256-gcm";

export const encryptData = (text: string, secretKey: string) => {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(secretKey).digest();
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
};

export const decryptData = (encryptedText: string, secretKey: string) => {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const key = crypto.createHash("sha256").update(secretKey).digest();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    console.error("❌ Decryption failed:", err);
    return null;
  }
};