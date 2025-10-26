// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = (req.headers.authorization || "") as string;
    if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer")
      return res.status(401).json({ success: false, message: "Invalid authorization format" });

    const token = parts[1];

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err: any) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    // Attach userId & other useful fields to request object
    (req as any).userId = decoded.userId;
    (req as any).username = decoded.username;
    (req as any).role = decoded.role;

    next();
  } catch (err) {
    console.error("[AUTH MIDDLEWARE] Error:", err);
    return res.status(500).json({ success: false, message: "Authentication error" });
  }
};