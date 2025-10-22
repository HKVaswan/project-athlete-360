import { Request, Response, NextFunction } from "express";

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    username?: string;
    role?: string;
  };
};

export const requireRole = (roles: string | string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    const userRole = req.user.role ?? "";

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }

    next();
  };
};