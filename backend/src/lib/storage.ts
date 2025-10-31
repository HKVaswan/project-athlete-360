import fs from "fs";
import path from "path";
import mime from "mime-types";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import { logger } from "../logger";
import crypto from "crypto";

export type StorageDriver = "s3" | "local";

/**
 * File storage abstraction layer for uploads, downloads, and secure access.
 */
class StorageService {
  private driver: StorageDriver;
  private s3: S3Client | null;
  private bucket: string;
  private localDir: string;

  constructor() {
    this.driver = (config.storageDriver as StorageDriver) || "local";
    this.bucket = config.s3Bucket || "athlete360-bucket";
    this.localDir = path.join(process.cwd(), "uploads");

    // Ensure local folder exists in dev
    if (this.driver === "local" && !fs.existsSync(this.localDir)) {
      fs.mkdirSync(this.localDir, { recursive: true });
    }

    this.s3 =
      this.driver === "s3"
        ? new S3Client({
            region: config.s3Region,
            credentials: {
              accessKeyId: config.s3AccessKey!,
              secretAccessKey: config.s3SecretKey!,
            },
          })
        : null;
  }

  /**
   * Generate a safe unique filename
   */
  private generateFileName(original: string): string {
    const ext = path.extname(original);
    const base = crypto.randomBytes(16).toString("hex");
    return `${base}${ext}`;
  }

  /**
   * Upload file buffer to configured storage.
   */
  async uploadFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType?: string
  ): Promise<{ url: string; key: string }> {
    const safeMime = mimeType || mime.lookup(originalName) || "application/octet-stream";
    const key = this.generateFileName(originalName);

    if (this.driver === "local") {
      const filePath = path.join(this.localDir, key);
      fs.writeFileSync(filePath, fileBuffer);
      return { url: `/uploads/${key}`, key };
    }

    // Upload to S3 or R2
    try {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: safeMime,
          ACL: "private",
        })
      );

      return {
        url: `https://${this.bucket}.s3.${config.s3Region}.amazonaws.com/${key}`,
        key,
      };
    } catch (err: any) {
      logger.error(`[STORAGE] Upload failed: ${err.message}`);
      throw new Error("File upload failed");
    }
  }

  /**
   * Generate a presigned URL for secure temporary access (download).
   */
  async getPresignedUrl(key: string, expiresInSec = 300): Promise<string> {
    if (this.driver === "local") {
      return `${config.apiBaseUrl}/uploads/${key}`;
    }

    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return await getSignedUrl(this.s3!, command, { expiresIn: expiresInSec });
    } catch (err: any) {
      logger.error(`[STORAGE] Presigned URL error: ${err.message}`);
      throw new Error("Failed to generate access URL");
    }
  }

  /**
   * Delete file from storage.
   */
  async deleteFile(key: string): Promise<void> {
    if (this.driver === "local") {
      const filePath = path.join(this.localDir, key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }

    try {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: "",
          ACL: "private",
        })
      );
    } catch (err: any) {
      logger.error(`[STORAGE] Delete failed: ${err.message}`);
    }
  }

  /**
   * Validate file size & type (safety guard for uploads)
   */
  validateFile(file: Express.Multer.File, maxSizeMB = 10): void {
    const allowed = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "video/mp4",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      throw new Error(`File too large (max ${maxSizeMB}MB)`);
    }
  }
}

export const storageService = new StorageService();