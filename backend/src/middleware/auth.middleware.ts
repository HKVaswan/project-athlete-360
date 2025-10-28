import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import logger from "../logger";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

// Extend Express Request for strong typing
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    email?: string;
  };
}

// ───────────────────────────────
// 🔒 Authentication Middleware
// ───────────────────────────────
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied: No or invalid authorization token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      logger.warn("Invalid or expired token", { token, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Session expired or invalid token.",
      });
    }

    // Attach user info to request
    req.user = {
      id: decoded.userId || decoded.id,
      username: decoded.username,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (err: any) {
    logger.error("❌ Auth Middleware Error", {
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      success: false,
      message: "Internal authentication error.",
    });
  }
};