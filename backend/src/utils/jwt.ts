// src/utils/jwt.ts
import jwt, { Secret, JwtPayload, SignOptions, StringValue } from "jsonwebtoken";
import logger from "../logger";

// ✅ Fallback secrets for safety
const JWT_SECRET: Secret = process.env.JWT_SECRET || "default_secret";
const REFRESH_SECRET: Secret = process.env.REFRESH_TOKEN_SECRET || "default_refresh_secret";

// ───────────────────────────────
// Generate Access Token
export function generateAccessToken(payload: Record<string, any>): string {
  try {
    const expiresIn = (process.env.JWT_EXPIRES_IN as StringValue) || "1h";
    const options: SignOptions = { expiresIn };
    return jwt.sign(payload, JWT_SECRET, options);
  } catch (err) {
    logger.error("Error generating access token: " + err);
    throw new Error("Token generation failed");
  }
}

// ───────────────────────────────
// Generate Refresh Token
export function generateRefreshToken(payload: Record<string, any>): string {
  try {
    const options: SignOptions = { expiresIn: "7d" as StringValue };
    return jwt.sign(payload, REFRESH_SECRET, options);
  } catch (err) {
    logger.error("Error generating refresh token: " + err);
    throw new Error("Refresh token generation failed");
  }
}

// ───────────────────────────────
// Verify Access Token
export function verifyAccessToken(token: string): string | JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    logger.warn("Invalid access token");
    return null;
  }
}

// ───────────────────────────────
// Verify Refresh Token
export function verifyRefreshToken(token: string): string | JwtPayload | null {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (err) {
    logger.warn("Invalid refresh token");
    return null;
  }
}