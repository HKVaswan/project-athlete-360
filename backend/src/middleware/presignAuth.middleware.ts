/**
 * src/middleware/presignAuth.middleware.ts
 * -------------------------------------------------------------------------
 * Secure Pre-Signed URL Authorization Middleware
 *
 * Purpose:
 *  - Authenticate requests for file uploads/downloads.
 *  - Verify active subscription and quota (storage, file type, size).
 *  - Prevent unauthorized or abusive uploads (spam / over-quota).
 *  - Integrate with S3 or GCP via secure token-based pre-signing.
 *
 * Features:
 *  - Role & plan-aware restrictions
 *  - File size limit enforcement
 *  - Rate-limiting via memory / Redis (optional)
 *  - Tamper-resistant signature validation
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config";
import { Errors, sendErrorResponse } from "../utils/errors";
import { verifySubscriptionActive } from "../services/subscription.service";
import { checkStorageQuota } from "../services/quota.service";
import { auditService } from "../lib/audit";
import { logger } from "../logger";

// Optional: implement a short-term cache to prevent repeated URL requests
const recentRequests = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 5;

/* --------------------------------------------------------------------------
   🔐 Middleware: Verify Auth + Subscription + Quota
--------------------------------------------------------------------------- */
export const authorizePresignRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = (req as any).user;

    if (!user)
      throw Errors.Unauthorized("Authentication required for presigned requests.");

    // ───────────────────────────────
    // 🧠 Rate Limiting
    // ───────────────────────────────
    const key = `${user.id}-${req.ip}`;
    const now = Date.now();
    const timestamps = recentRequests.get(key) || 0;
    if (timestamps && now - timestamps < RATE_LIMIT_WINDOW_MS) {
      throw Errors.TooManyRequests("Too many presign requests. Try again later.");
    }
    recentRequests.set(key, now);

    // ───────────────────────────────
    // 💳 Subscription Validation
    // ───────────────────────────────
    const subscriptionValid = await verifySubscriptionActive(user.id);
    if (!subscriptionValid)
      throw Errors.Forbidden("Active subscription required to upload or access files.");

    // ───────────────────────────────
    // 📦 Storage Quota Check
    // ───────────────────────────────
    const { contentType, contentLength } = req.headers;
    const size = Number(contentLength || req.body?.size || 0);
    const fileType = contentType || "application/octet-stream";

    const allowed = await checkStorageQuota(user.id, size, fileType);
    if (!allowed) {
      await auditService.log({
        actorId: user.id,
        actorRole: user.role,
        action: "SECURITY_EVENT",
        details: { reason: "Storage quota exceeded", fileType, size },
      });
      throw Errors.Forbidden("Storage quota exceeded for your current plan.");
    }

    // ───────────────────────────────
    // ✅ Signature Validation (optional anti-tamper)
    // ───────────────────────────────
    const clientSig = req.query.sig as string | undefined;
    if (clientSig) {
      const computed = crypto
        .createHmac("sha256", config.jwt.secret)
        .update(`${user.id}:${req.ip}`)
        .digest("hex");
      if (computed !== clientSig) {
        throw Errors.Forbidden("Invalid request signature detected.");
      }
    }

    // Everything looks good — continue to presign handler
    next();
  } catch (err) {
    logger.error("[PRESIGN] ❌ Authorization failed", { error: err });
    sendErrorResponse(res, err);
  }
};

/* --------------------------------------------------------------------------
   🧩 Utility: Generate Server-Side Presigned URL (optional helper)
--------------------------------------------------------------------------- */
// This is NOT middleware — an example helper you can export for routes
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKey!,
    secretAccessKey: config.aws.secretKey!,
  },
});

/**
 * Generate presigned upload URL for S3 securely
 */
export const generatePresignedUploadUrl = async (
  userId: string,
  fileName: string,
  contentType: string
): Promise<{ url: string; key: string }> => {
  const key = `uploads/${userId}/${Date.now()}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 60 * 5 }); // 5 min
  return { url, key };
};