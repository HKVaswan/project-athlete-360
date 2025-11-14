// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient";
import { config } from "../config";
import { Errors } from "../utils/errors";
import logger from "../logger";

export interface AuthPayload {
  userId: string;
  username?: string;
  role?: string;
  mfaVerified?: boolean;
  impersonatedBy?: string | null;
  sessionVersion?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username?: string;
    role?: string;
    sessionVersion?: number;
  };
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || req.headers["x-access-token"];
    if (!header) throw Errors.Auth("Authorization token missing");

    const token = (header as string).replace(/^Bearer\s+/i, "");
    let decoded: AuthPayload | null = null;
    try {
      decoded = jwt.verify(token, config.jwt.secret) as AuthPayload;
    } catch (err) {
      throw Errors.Auth("Invalid or expired token");
    }

    if (!decoded?.userId) throw Errors.Auth("Invalid token payload");

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) throw Errors.Auth("User not found");

    // session version check (to invalidate tokens after password reset/logout-all)
    if (typeof decoded.sessionVersion === "number" && decoded.sessionVersion !== user.sessionVersion) {
      throw Errors.Auth("Token session version mismatch (stale token)");
    }

    // attach
    req.user = {
      id: user.id,
      username: user.username ?? undefined,
      role: user.role as unknown as string,
      sessionVersion: user.sessionVersion,
    };

    next();
  } catch (err: any) {
    logger.warn("[AUTH] requireAuth failed", { err: err?.message || err });
    return res.status(err?.status || 401).json({
      success: false,
      message: err?.message || "Unauthorized",
    });
  }
};