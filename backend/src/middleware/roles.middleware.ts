import { Request, Response, NextFunction } from "express";

// ✅ Define a compatible type for user payload
interface AuthenticatedUser {
  id: string;
  role: string;
  username?: string;
  [key: string]: any;
}

// ✅ Extend Express Request safely
export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

// ✅ Role-based access control middleware
export const requireRole = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    const userRole = req.user.role;

    // ✅ Ensure role exists before checking
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }

    next();
  };
};