/**
 * Upload Middleware (Enterprise-Grade)
 * -----------------------------------
 * Supports both:
 *  1. Direct local uploads (via Multer)
 *  2. AWS S3 presigned URL generation (for production)
 */

import multer from "multer";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import AWS from "aws-sdk";

// ───────────────────────────────
// CONFIGURATION
// ───────────────────────────────

const MAX_FILE_SIZE_MB = 25;
const UPLOAD_DIR = path.join(__dirname, "../../uploads");

const s3Enabled = Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

if (s3Enabled) {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    region: process.env.AWS_REGION || "ap-south-1",
  });
}

const s3 = s3Enabled ? new AWS.S3() : null;

// ───────────────────────────────
// HELPER: Generate unique file name
// ───────────────────────────────
const generateFileName = (originalName: string) => {
  const ext = path.extname(originalName);
  const base = crypto.randomBytes(12).toString("hex");
  return `${base}${ext}`;
};

// ───────────────────────────────
// LOCAL STORAGE UPLOAD CONFIG (for dev / fallback)
// ───────────────────────────────
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, generateFileName(file.originalname)),
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "video/mp4",
    "text/plain",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Unsupported file type"));
};

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter,
});

// ───────────────────────────────
// PRESIGNED URL HANDLER (for S3 direct uploads)
// ───────────────────────────────
export const generatePresignedUrl = async (req: Request, res: Response) => {
  try {
    if (!s3Enabled || !s3) {
      return res.status(503).json({
        success: false,
        message: "S3 not configured on server.",
      });
    }

    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "Missing fileName or fileType" });
    }

    const uniqueName = generateFileName(fileName);
    const s3Params = {
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: `uploads/${uniqueName}`,
      Expires: 60 * 5, // 5 minutes
      ContentType: fileType,
    };

    const uploadUrl = await s3.getSignedUrlPromise("putObject", s3Params);
    const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-south-1"}.amazonaws.com/uploads/${uniqueName}`;

    res.json({
      success: true,
      uploadUrl,
      fileUrl,
    });
  } catch (err: any) {
    console.error("[UPLOAD] Presigned URL error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
    });
  }
};

// ───────────────────────────────
// ERROR HANDLER for Multer
// ───────────────────────────────
export const uploadErrorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error("[UPLOAD] Error:", err.message);
  res.status(400).json({
    success: false,
    message: err.message || "File upload failed",
  });
};

// ───────────────────────────────
// USAGE IN ROUTES:
// ───────────────────────────────
//
// import { upload, uploadErrorHandler, generatePresignedUrl } from "../middleware/upload.middleware";
//
// // Direct upload
// router.post("/upload", upload.single("file"), uploadErrorHandler, controller.handleFileUpload);
//
// // S3 Presigned
// router.post("/presigned-url", generatePresignedUrl);
//
// ───────────────────────────────