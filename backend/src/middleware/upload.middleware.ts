import multer from "multer";
import path from "path";
import { Request } from "express";
import { S3Client } from "@aws-sdk/client-s3";
import multerS3 from "multer-s3";
import logger from "../logger";

// ───────────────────────────────
// 🧠 Environment Config
// ───────────────────────────────
const isProd = process.env.NODE_ENV === "production";
const bucketName = process.env.AWS_S3_BUCKET || "";
const region = process.env.AWS_REGION || "us-east-1";

// ───────────────────────────────
// ☁️ S3 Client (for production)
// ───────────────────────────────
const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

// ───────────────────────────────
// 🗂 Local Storage Config (Dev)
// ───────────────────────────────
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../uploads/"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

// ───────────────────────────────
// ☁️ S3 Storage Config (Prod)
// ───────────────────────────────
const s3Storage = multerS3({
  s3,
  bucket: bucketName,
  acl: "private",
  key: function (req: Request, file, cb) {
    const uniqueName = `${Date.now()}_${file.originalname}`;
    cb(null, `uploads/${uniqueName}`);
  },
});

// ───────────────────────────────
// 🧩 File Filter — Security Layer
// ───────────────────────────────
const fileFilter = (req: Request, file: any, cb: any) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "video/mp4",
    "text/plain",
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    logger.warn(`❌ File type not allowed: ${file.mimetype}`);
    return cb(new Error("Invalid file type"), false);
  }
  cb(null, true);
};

// ───────────────────────────────
// 📦 Final Upload Middleware
// ───────────────────────────────
const upload = multer({
  storage: isProd ? s3Storage : localStorage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
});

export default upload;