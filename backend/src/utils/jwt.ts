// src/utils/jwt.ts
import jwt, { Secret, JwtPayload } from "jsonwebtoken";
import logger from "../logger";

// Use strict Secret type and fallback for safety
const JWT_SECRET = process.env.JWT_SECRET as Secret;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET as Secret;

// ───────────────────────────────
// Generate Access Token
export function generateAccessToken(payload: Record<string, any>): string {
  try {
    const expiresIn = process.env.JWT_EXPIRES_IN || "1h";
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  } catch (err) {
    logger.error("Error generating access token: " + err);
    throw new Error("Token generation failed");
  }
}

// ───────────────────────────────
// Generate Refresh Token
export function generateRefreshToken(payload: Record<string, any>): string {
  try {
    return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });
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