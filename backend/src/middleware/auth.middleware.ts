// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("❌ JWT_SECRET not set in environment variables.");

interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    institutionId?: string;
  };
}

// ───────────────────────────────
// 🔐 requireAuth
// Validates JWT access token and attaches user info
// ───────────────────────────────
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ success: false, message: "Authorization header missing" });

    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token)
      return res.status(401).json({ success: false, message: "Invalid authorization format" });

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err: any) {
      logger.warn(`[AUTH] Invalid token: ${err.message}`);
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    if (!decoded || !decoded.userId)
      return res.status(401).json({ success: false, message: "Malformed token" });

    // Attach decoded data
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      institutionId: decoded.institutionId,
    };

    logger.debug(`[AUTH] Verified user=${decoded.username} role=${decoded.role}`);
    next();
  } catch (err: any) {
    logger.error(`[AUTH] Unexpected error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Authentication middleware error" });
  }
};

// ───────────────────────────────
// 🛡 requireRole(...roles)
// Restricts access to users having certain roles
// ───────────────────────────────
export const requireRole =
  (...allowedRoles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user)
      return res.status(401).json({ success: false, message: "User not authenticated" });

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        `[AUTH] Unauthorized access: user=${req.user.username} role=${req.user.role} attempted restricted route`
      );
      return res.status(403).json({ success: false, message: "Access forbidden: insufficient permissions" });
    }

    next();
  };

// ───────────────────────────────
// 🧠 optionalAuth
// Allows optional authentication (e.g., public endpoints)
// ───────────────────────────────
export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      institutionId: decoded.institutionId,
    };
    logger.debug(`[AUTH] Optional auth: user=${decoded.username}`);
  } catch (err) {
    logger.warn("[AUTH] Optional auth token invalid or expired, continuing anonymously");
  }

  next();
};

export type { AuthRequest };