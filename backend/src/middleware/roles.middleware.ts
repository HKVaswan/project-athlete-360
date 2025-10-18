import { Request, Response, NextFunction } from "express";

export function requireRole(...allowedRoles: string[]) {
  return (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.includes(role)) return res.status(403).json({ message: "Access denied. Insufficient permissions." });
    next();
  };
}
