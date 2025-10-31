// src/lib/s3.ts
/**
 * Enterprise-grade S3 helper
 * - Uses AWS SDK v3 (S3Client) + @aws-sdk/lib-storage for multipart
 * - Supports:
 *    * uploadBuffer, uploadStream, uploadFile (multipart)
 *    * generatePresignedUploadUrl (client side direct upload)
 *    * getObjectUrl, deleteObject
 *    * server-side encryption (SSE-S3 / optional KMS)
 *    * structured logging + metrics hooks
 *    * robust error handling & retries
 *
 * Note: Provide `config` (see src/config) or adjust to use process.env values.
 */

import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommandInput,
  DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Logger } from "winston";
import { config } from "../config";
import logger from "../logger";

// Optional metrics interface (implement in your metrics lib)
type Metrics = {
  increment: (name: string, value?: number, labels?: Record<string, string>) => void;
  gauge?: (name: string, value: number, labels?: Record<string, string>) => void;
};

const DEFAULT_REGION = config.awsRegion || "us-east-1";
const DEFAULT_BUCKET = config.awsBucket;
if (!DEFAULT_BUCKET) {
  logger.warn("S3: AWS_BUCKET not configured. S3 functions will fail until bucket set.");
}

// S3 client singleton
const s3Client = new S3Client({
  region: DEFAULT_REGION,
  credentials:
    config.awsAccessKeyId && config.awsSecretAccessKey
      ? {
          accessKeyId: config.awsAccessKeyId,
          secretAccessKey: config.awsSecretAccessKey,
        }
      : undefined,
  // optional: set custom retry strategy through client config if desired
});

// Helper: default SSE and ACL config
const defaultSSE = config.s3Sse || null; // e.g. 'AES256' or 'aws:kms'
const defaultSseKmsKeyId = config.s3SseKmsKeyId || undefined;
const defaultAcl = config.s3Acl || "private"; // keep private by default

// Retry/backoff helper (exponential)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 300
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const wait = baseMs * Math.pow(2, i);
      logger.warn(`S3 retry ${i + 1}/${attempts} after error: ${err?.message || err}. waiting ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastError;
}

// -----------------------------
// Types & Options
// -----------------------------
export type UploadOptions = {
  bucket?: string;
  key: string;
  contentType?: string;
  acl?: string;
  metadata?: Record<string, string>;
  sse?: "AES256" | "aws:kms" | null;
  sseKmsKeyId?: string | null;
  cacheControl?: string | null;
  publicRead?: boolean; // convenience toggle for acl
  visibility?: "private" | "public-read";
  // metrics hook (optional)
  metrics?: Metrics;
};

// -----------------------------
// Public Helpers
// -----------------------------

/**
 * Upload a Buffer or string to S3 (small-to-medium files).
 */
export async function uploadBuffer(
  buffer: Buffer | Uint8Array | string,
  options: UploadOptions
): Promise<{ bucket: string; key: string; url: string }> {
  const bucket = options.bucket || DEFAULT_BUCKET!;
  if (!bucket) throw new Error("S3 bucket not configured.");

  const commandInput: PutObjectCommandInput = {
    Bucket: bucket,
    Key: options.key,
    Body: buffer as any,
    ContentType: options.contentType,
    ACL: options.visibility === "public" || options.publicRead ? "public-read" : defaultAcl,
    Metadata: options.metadata,
    CacheControl: options.cacheControl ?? undefined,
  };

  if (options.sse ?? defaultSSE) {
    const sse = options.sse ?? defaultSSE;
    if (sse === "AES256") {
      (commandInput as any).ServerSideEncryption = "AES256";
    } else if (sse === "aws:kms") {
      (commandInput as any).ServerSideEncryption = "aws:kms";
      if (options.sseKmsKeyId ?? defaultSseKmsKeyId) {
        (commandInput as any).SSEKMSKeyId = options.sseKmsKeyId ?? defaultSseKmsKeyId;
      }
    }
  }

  const putObject = async () => {
    const cmd = new PutObjectCommand(commandInput);
    await s3Client.send(cmd);
  };

  await withRetries(putObject, 3, 300);

  const url = getObjectUrl(bucket, options.key);
  try {
    options.metrics?.increment("s3_upload_success");
  } catch {}
  logger.info(`S3: uploaded buffer to s3://${bucket}/${options.key}`);
  return { bucket, key: options.key, url };
}

/**
 * Upload a readable stream using @aws-sdk/lib-storage (multipart if large)
 * Great for file streams from disk or uploads from client (server side).
 */
export async function uploadStream(
  stream: Readable,
  options: UploadOptions
): Promise<{ bucket: string; key: string; url: string }> {
  const bucket = options.bucket || DEFAULT_BUCKET!;
  if (!bucket) throw new Error("S3 bucket not configured.");

  const params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: options.key,
    Body: stream,
    ContentType: options.contentType,
    ACL: options.visibility === "public" || options.publicRead ? "public-read" : defaultAcl,
    Metadata: options.metadata,
    CacheControl: options.cacheControl ?? undefined,
  };

  if (options.sse ?? defaultSSE) {
    const sse = options.sse ?? defaultSSE;
    if (sse === "AES256") {
      (params as any).ServerSideEncryption = "AES256";
    } else if (sse === "aws:kms") {
      (params as any).ServerSideEncryption = "aws:kms";
      if (options.sseKmsKeyId ?? defaultSseKmsKeyId) {
        (params as any).SSEKMSKeyId = options.sseKmsKeyId ?? defaultSseKmsKeyId;
      }
    }
  }

  const upload = new Upload({
    client: s3Client,
    params,
    queueSize: 4, // concurrency for multipart uploads
    partSize: 5 * 1024 * 1024, // 5MB multipart chunk
    leavePartsOnError: false,
  });

  try {
    const result = await upload.done();
    options.metrics?.increment("s3_multipart_upload_success");
    logger.info(`S3: stream uploaded to s3://${bucket}/${options.key} (etag=${result.ETag})`);
    return { bucket, key: options.key, url: getObjectUrl(bucket, options.key) };
  } catch (err: any) {
    options.metrics?.increment("s3_multipart_upload_failure");
    logger.error(`S3: multipart upload failed for s3://${bucket}/${options.key}: ${err.message || err}`);
    throw err;
  }
}

/**
 * Upload a local file path using lib-storage (convenience)
 */
export async function uploadFile(
  fileStream: Readable,
  options: UploadOptions
): Promise<{ bucket: string; key: string; url: string }> {
  // This is same as uploadStream, left for naming clarity
  return uploadStream(fileStream, options);
}

/**
 * Generate presigned PUT URL for client direct upload.
 * Note: For files > 5-10MB clients should implement multipart with presigned part URLs.
 */
export async function generatePresignedUploadUrl(
  key: string,
  opts?: {
    bucket?: string;
    expiresInSeconds?: number;
    contentType?: string;
    visibility?: "private" | "public-read";
    sse?: "AES256" | "aws:kms" | null;
  }
): Promise<{ url: string; key: string; expiresIn: number }> {
  const bucket = opts?.bucket || DEFAULT_BUCKET!;
  if (!bucket) throw new Error("S3 bucket not configured.");

  const expiresIn = opts?.expiresInSeconds ?? 60 * 10; // 10 minutes default

  const putInput: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    ContentType: opts?.contentType,
    ACL: opts?.visibility === "public-read" ? "public-read" : defaultAcl,
  };

  if (opts?.sse ?? defaultSSE) {
    const sse = opts?.sse ?? defaultSSE;
    if (sse === "AES256") {
      (putInput as any).ServerSideEncryption = "AES256";
    } else if (sse === "aws:kms") {
      (putInput as any).ServerSideEncryption = "aws:kms";
      if (defaultSseKmsKeyId) (putInput as any).SSEKMSKeyId = defaultSseKmsKeyId;
    }
  }

  const cmd = new PutObjectCommand(putInput);
  const url = await getSignedUrl(s3Client, cmd, { expiresIn });

  logger.debug(`S3: generated presigned upload URL for s3://${bucket}/${key} (expiresIn=${expiresIn}s)`);
  return { url, key, expiresIn };
}

/**
 * Get public object URL (not presigned). Useful for public-read objects.
 * For private objects, use presigned GET URLs.
 */
export function getObjectUrl(bucket: string, key: string) {
  const region = DEFAULT_REGION;
  // Use virtual-hosted-style URL (works for most setups incl. CloudFront)
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;
}

/**
 * Generate a presigned GET URL (for private objects)
 */
export async function generatePresignedGetUrl(key: string, bucket?: string, expiresInSeconds = 60 * 10) {
  const b = bucket || DEFAULT_BUCKET!;
  if (!b) throw new Error("S3 bucket not configured.");
  const cmd = new GetObjectCommand({ Bucket: b, Key: key });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresInSeconds });
}

/**
 * Delete object
 */
export async function deleteObject(
  key: string,
  bucket?: string,
  metrics?: Metrics
): Promise<{ removed: boolean }> {
  const b = bucket || DEFAULT_BUCKET!;
  if (!b) throw new Error("S3 bucket not configured.");

  const delInput: DeleteObjectCommandInput = { Bucket: b, Key: key };

  try {
    await withRetries(async () => {
      const cmd = new DeleteObjectCommand(delInput);
      await s3Client.send(cmd);
    }, 3, 250);

    metrics?.increment?.("s3_delete_success");
    logger.info(`S3: deleted object s3://${b}/${key}`);
    return { removed: true };
  } catch (err: any) {
    metrics?.increment?.("s3_delete_failure");
    logger.error(`S3: delete failed for s3://${b}/${key}: ${err.message || err}`);
    // If object didn't exist (404 in some SDKs) treat as success for idempotency
    throw err;
  }
}

/**
 * Safe head check (does object exist)
 */
export async function objectExists(key: string, bucket?: string): Promise<boolean> {
  const b = bucket || DEFAULT_BUCKET!;
  if (!b) throw new Error("S3 bucket not configured.");
  try {
    const cmd = new HeadObjectCommand({ Bucket: b, Key: key });
    await s3Client.send(cmd);
    return true;
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) return false;
    logger.warn(`S3 headObject check failed for ${b}/${key}: ${err.message || err}`);
    throw err;
  }
}

// -----------------------------
// Export default helper (convenience)
export default {
  uploadBuffer,
  uploadStream,
  uploadFile,
  generatePresignedUploadUrl,
  generatePresignedGetUrl,
  getObjectUrl,
  deleteObject,
  objectExists,
  client: s3Client,
};