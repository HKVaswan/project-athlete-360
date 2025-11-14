// src/utils/s3Helpers.ts
import { uploadToS3, deleteFromS3 } from "../integrations/s3";

export const s3Helpers = {
  async uploadBuffer(key: string, buffer: Buffer) {
    return uploadToS3(key, buffer);
  },
  async deleteKey(key: string) {
    return deleteFromS3(key);
  },
};

export default s3Helpers;
