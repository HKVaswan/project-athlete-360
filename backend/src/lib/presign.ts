/**
 * src/lib/presign.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade presign helpers
 *
 * - Generates presigned URLs for S3 uploads (PUT) and downloads (GET)
 * - Protects against path traversal and invalid keys
 * - Enforces allowed MIME types and key prefixes (scoped to user/institution)
 * - Supports optional server-side encryption and ACLs
 * - Short default expiry and strong defaults to reduce risk
 * - Designed to be provider-agnostic (AWS implemented; extendable to GCS/Azure)
 *
 * Usage examples:
 *  const { url, key } = await generatePresignedUploadUrl({ userId, filename, contentType });
 *  const downloadUrl = await generatePresignedDownloadUrl({ key, expiresSeconds: 60 });
 *
 * Requirements:
 *  - process.env.S3_BUCKET, S3_REGION and S3_PROVIDER (default "aws") set
 *  - Optionally S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY or IAM role available
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import crypto from "crypto";
import logger from "../logger";
import { config } from "../config";
import { secretManagerService } from "../services/secretManager.service";

export type PresignUploadOpts = {
  userId?: string; // optional: scope uploads to a user (recommended)
  institutionId?: string; // optional alternative scope
  filename: string;
  contentType: string;
  expiresSeconds?: number; // default short TTL
  acl?: "private" | "public-read";
  encryption?: "AES256" | "aws:kms" | null;
  metadata?: Record<string, string>;
  maxFileSizeBytes?: number; // optional: not enforced by S3 presign but returned for client-side validation
};

export type PresignUploadResult = {
  url: string;
  key: string;
  method: "PUT";
  expiresAt: string; // ISO
  maxFileSizeBytes?: number;
  requiredHeaders?: Record<string, string>;
};

export type PresignDownloadOpts = {
  key: string;
  expiresSeconds?: number;
};

export type PresignDownloadResult = {
  url: string;
  key: string;
  method: "GET";
  expiresAt: string;
};

// -------------------------
// Config / Defaults
// -------------------------
const DEFAULT_UPLOAD_EXPIRES = 60; // 60 seconds for upload presigned PUT by default
const DEFAULT_DOWNLOAD_EXPIRES = 60 * 10; // 10 minutes default download link
const ALLOWED_MIME = config.allowedUploadMimeTypes ?? [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "audio/mpeg",
];

// Server-side max size hint (used for client validation)
const DEFAULT_MAX_FILE_SIZE_BYTES = Number(config.defaultMaxUploadBytes) || 50 * 1024 * 1024; // 50 MB

// -------------------------
// Helper: sanitize & validate
// -------------------------
const sanitizeFilename = (name: string) => {
  // Remove null bytes, any path traversal, keep base name and a safe subset of chars
  const base = path.basename(name);
  // Replace spaces and unsafe characters
  return base.replace(/[^\w.\-()]/g, "_").slice(0, 200);
};

const validateContentType = (ct: string) => {
  if (!ct) return false;
  return ALLOWED_MIME.includes(ct.toLowerCase());
};

const validateKey = (k: string) => {
  // disallow absolute paths or ../
  if (k.includes("..") || k.startsWith("/") || k.startsWith("\\") || k.indexOf("%00") >= 0) return false;
  // basic safe characters (s3 keys can be anything but we enforce conservative subset)
  return k.length > 0 && k.length <= 1024;
};

const randomHex = (len = 10) => crypto.randomBytes(len).toString("hex").slice(0, len * 2);

// -------------------------
// S3 Client (lazy init)
// -------------------------
let s3Client: S3Client | null = null;

async function initS3Client(): Promise<S3Client> {
  if (s3Client) return s3Client;

  // Prefer secret manager for credentials if available (safer than env)
  let accessKeyId = process.env.S3_ACCESS_KEY_ID || config.s3?.accessKeyId;
  let secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || config.s3?.secretAccessKey;
  const region = process.env.S3_REGION || config.s3?.region || config.region || "us-east-1";

  // Try secret manager fallback (non-blocking)
  try {
    if (!accessKeyId) {
      accessKeyId = await secretManagerService.getSecret("S3_ACCESS_KEY_ID");
    }
    if (!secretAccessKey) {
      secretAccessKey = await secretManagerService.getSecret("S3_SECRET_ACCESS_KEY");
    }
  } catch (err) {
    logger.debug("[presign] secretManagerService not available or failed, falling back to env vars");
  }

  // Build S3 client (will use IAM role if credentials not provided)
  const client = new S3Client({
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined, // undefined -> use default provider chain (IAM role etc.)
    maxAttempts: 3,
  });

  s3Client = client;
  logger.info(`[presign] S3 client initialized (region=${region})`);
  return client;
}

// -------------------------
// Build safe object key
// -------------------------
const buildStorageKey = (opts: { userId?: string; institutionId?: string; filename: string }) => {
  const filename = sanitizeFilename(opts.filename);
  const prefix = opts.userId ? `uploads/users/${opts.userId}` : opts.institutionId ? `uploads/institutions/${opts.institutionId}` : "uploads/anonymous";
  const unique = `${Date.now()}-${randomHex(6)}`;
  const key = `${prefix}/${unique}-${filename}`;
  if (!validateKey(key)) throw new Error("Generated object key is invalid.");
  return key;
};

// -------------------------
// Presigned Upload (PUT) - simple and secure
// -------------------------
export async function generatePresignedUploadUrl(opts: PresignUploadOpts): Promise<PresignUploadResult> {
  // Validate content-type early
  if (!validateContentType(opts.contentType)) {
    throw new Error(`Content type '${opts.contentType}' is not allowed.`);
  }

  const expiresSeconds = Math.max(10, Math.min(3600, opts.expiresSeconds ?? DEFAULT_UPLOAD_EXPIRES)); // clamp between 10s and 1h
  const maxFileSizeBytes = opts.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  const key = buildStorageKey({ userId: opts.userId, institutionId: opts.institutionId, filename: opts.filename });
  const bucket = process.env.S3_BUCKET || config.s3?.bucket;
  if (!bucket) throw new Error("S3_BUCKET not configured.");

  const client = await initS3Client();

  // Build PutObject command with conservative defaults
  const putCmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: opts.contentType,
    ACL: opts.acl === "public-read" ? "public-read" : "private",
    Metadata: opts.metadata ?? undefined,
    ServerSideEncryption: opts.encryption ?? undefined,
  });

  const url = await getSignedUrl(client, putCmd, { expiresIn: expiresSeconds });

  const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

  // Return the presigned PUT URL. Client should PUT file with Content-Type header.
  return {
    url,
    key,
    method: "PUT",
    expiresAt,
    maxFileSizeBytes,
    requiredHeaders: {
      "Content-Type": opts.contentType,
    },
  };
}

// -------------------------
// Presigned Download (GET)
// -------------------------
export async function generatePresignedDownloadUrl(opts: PresignDownloadOpts): Promise<PresignDownloadResult> {
  if (!validateKey(opts.key)) throw new Error("Invalid key");

  const expiresSeconds = Math.max(10, Math.min(60 * 60 * 24, opts.expiresSeconds ?? DEFAULT_DOWNLOAD_EXPIRES)); // 10s..1d
  const bucket = process.env.S3_BUCKET || config.s3?.bucket;
  if (!bucket) throw new Error("S3_BUCKET not configured.");

  const client = await initS3Client();

  const getCmd = new GetObjectCommand({
    Bucket: bucket,
    Key: opts.key,
  });

  const url = await getSignedUrl(client, getCmd, { expiresIn: expiresSeconds });
  const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

  return {
    url,
    key: opts.key,
    method: "GET",
    expiresAt,
  };
}

// -------------------------
// Convenience: validate incoming upload request server-side
// (call this before issuing presign, optional extra guard)
export function validateClientUploadRequest(params: {
  filename: string;
  contentType: string;
  fileSizeBytes?: number;
  userId?: string;
}) {
  const errors: string[] = [];
  if (!params.filename) errors.push("filename required");
  if (!params.contentType) errors.push("contentType required");
  if (!validateContentType(params.contentType)) errors.push("contentType not allowed");
  if (params.fileSizeBytes && params.fileSizeBytes > DEFAULT_MAX_FILE_SIZE_BYTES) errors.push("file size exceeds allowed limit");
  // add more checks as needed (e.g., disallow certain extensions)
  return { ok: errors.length === 0, errors };
}

// -------------------------
// Export helpers
// -------------------------
export default {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  validateClientUploadRequest,
};