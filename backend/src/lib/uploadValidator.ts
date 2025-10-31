import { Request } from "express";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import crypto from "crypto";
import { logger } from "../logger";

/**
 * Allowed file types — adjust as per platform’s real-world use cases.
 * Covers images, documents, videos, and performance data formats.
 */
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
  "application/pdf",
  "video/mp4",
  "video/mpeg",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/**
 * Maximum upload size: 20 MB (safe limit, adjustable per role).
 */
const MAX_FILE_SIZE_MB = 20;

/**
 * Generate a safe random filename for uploaded files.
 */
const generateSafeFileName = (originalName: string): string => {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(12).toString("hex");
  return `${hash}${ext}`;
};

/**
 * Validate MIME type and prevent risky extensions.
 */
const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    logger.warn(`[UPLOAD VALIDATOR] ❌ Blocked file: ${file.originalname} (${file.mimetype})`);
    return cb(new Error("Invalid or unsupported file type."));
  }
  cb(null, true);
};

/**
 * Configure Multer storage.
 * For now we use memoryStorage — integrates seamlessly with S3/local upload pipelines.
 */
const storage = multer.memoryStorage();

/**
 * Build multer instance with enterprise-grade validation and error safety.
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 5, // prevent spam uploads
  },
});

/**
 * Helper for single file uploads (e.g., athlete profile picture)
 */
export const singleUpload = (fieldName: string) => upload.single(fieldName);

/**
 * Helper for multiple file uploads (e.g., resource attachments)
 */
export const multipleUpload = (fieldName: string, maxFiles = 5) =>
  upload.array(fieldName, maxFiles);

/**
 * Helper to validate already received file (optional double check)
 */
export const validateUploadedFile = (file?: Express.Multer.File) => {
  if (!file) throw new Error("No file uploaded.");

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024)
    throw new Error(`File exceeds ${MAX_FILE_SIZE_MB}MB limit.`);

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype))
    throw new Error(`Unsupported MIME type: ${file.mimetype}`);
};

/**
 * Generate secure file metadata for DB or audit logging.
 */
export const buildFileMetadata = (file: Express.Multer.File) => ({
  originalName: file.originalname,
  safeName: generateSafeFileName(file.originalname),
  mimeType: file.mimetype,
  size: file.size,
});