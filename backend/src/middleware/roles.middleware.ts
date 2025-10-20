// src/middleware/roles.middleware.ts
import { Request, Response, NextFunction } from "express";

// ✅ Define AuthRequest type inline (no need for external import)
interface AuthRequest extends Request {
  user?: {
    id?: string;
    role?: string;
    [key: string]: any;
  };
}

// ✅ Role-based access middleware
export const requireRole = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }

    next();
  };
};