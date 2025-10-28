import multer from "multer";
import path from "path";
import crypto from "crypto";
import { Request } from "express";
import logger from "../logger";

// ───────────────────────────────
// 🧠 Configuration
// ───────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Allowed file types for uploads (expand if needed)
const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "video/mp4",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// ───────────────────────────────
// 🗂 Local disk storage (fallback or dev mode)
// ───────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), "uploads/"));
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);
    const safeName = file.originalname
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${Date.now()}-${uniqueSuffix}-${safeName}${ext}`);
  },
});

// ───────────────────────────────
// 🧰 File filter for safety
// ───────────────────────────────
function fileFilter(req: Request, file: Express.Multer.File, cb: any) {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    logger.warn(`❌ Blocked upload: Invalid file type (${file.mimetype})`);
    return cb(new Error("Invalid file type. Upload JPG, PNG, PDF, or MP4 only."));
  }
  cb(null, true);
}

// ───────────────────────────────
// ⚙️ Multer instance
// ───────────────────────────────
export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

// ───────────────────────────────
// 🚀 Single file upload middleware
// Example usage: upload.single("document")
// ───────────────────────────────
export const singleUpload = (fieldName: string) => upload.single(fieldName);

// ───────────────────────────────
// 📦 Multi-file upload middleware
// Example usage: upload.array("files", 5)
// ───────────────────────────────
export const multiUpload = (fieldName: string, maxCount = 5) =>
  upload.array(fieldName, maxCount);

// ───────────────────────────────
// 🧹 Safe error handler
// ───────────────────────────────
export function handleUploadError(err: any, _req: Request, res: any, _next: any) {
  if (err instanceof multer.MulterError) {
    logger.error("❌ Multer Error: " + err.message);
    return res.status(400).json({
      success: false,
      message: "File upload error: " + err.message,
    });
  } else if (err) {
    logger.error("❌ Upload Error: " + err.message);
    return res.status(400).json({
      success: false,
      message: err.message || "Unexpected upload error.",
    });
  }
  return _next();
}