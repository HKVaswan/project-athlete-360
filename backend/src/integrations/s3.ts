// src/integrations/s3.ts
import fs from "fs";
import path from "path";
import logger from "../logger";

const LOCAL_S3_DIR = path.join(process.cwd(), "local_s3");

if (!fs.existsSync(LOCAL_S3_DIR)) fs.mkdirSync(LOCAL_S3_DIR, { recursive: true });

export async function uploadToS3(key: string, buffer: Buffer | string) {
  const dest = path.join(LOCAL_S3_DIR, key);
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await fs.promises.writeFile(dest, buffer);
  logger.info("[S3] uploaded", { key, dest });
  return { key, url: `file://${dest}` };
}

export async function deleteFromS3(key: string) {
  const dest = path.join(LOCAL_S3_DIR, key);
  try {
    await fs.promises.unlink(dest);
    logger.info("[S3] deleted", { key });
    return true;
  } catch (err: any) {
    logger.warn("[S3] delete failed", { key, error: err.message });
    return false;
  }
}

export default { uploadToS3, deleteFromS3 };