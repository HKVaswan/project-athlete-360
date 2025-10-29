// src/services/resource.service.ts
/**
 * Resource Service — Enterprise-grade
 * -----------------------------------
 * Manages shared learning/training resources, uploaded files, and documents.
 * Features:
 *  - Upload, list, delete, and update metadata
 *  - Secure ownership & institutional access
 *  - Pagination + query filters
 *  - Future AI tagging + preview analysis integration
 *  - S3 / Cloud-ready architecture
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate, computeNextCursor } from "../utils/pagination";
import { uploadToS3, deleteFromS3 } from "../integrations/s3";

type UploadResourceInput = {
  uploaderId: string;
  institutionId: string;
  title: string;
  description?: string;
  tags?: string[];
  fileUrl: string;
  fileType: string;
  fileSize: number;
};

type GetResourcesQuery = {
  search?: string;
  tag?: string;
  institutionId?: string;
  limit?: string | number;
  page?: string | number;
  cursor?: string;
};

type UpdateResourceInput = {
  title?: string;
  description?: string;
  tags?: string[];
};

/**
 * 🧩 Create / Upload new resource
 * Handles file metadata and upload integration (S3, Cloudinary, etc.)
 */
export const uploadResource = async (payload: UploadResourceInput) => {
  const { uploaderId, institutionId, title, description, tags, fileUrl, fileType, fileSize } =
    payload;

  if (!uploaderId || !institutionId || !title || !fileUrl || !fileType) {
    throw Errors.Validation("Missing required fields for resource upload");
  }

  // Validate file size & type limits (security)
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const ALLOWED_TYPES = ["image/", "video/", "application/pdf", "text/plain", "application/msword"];
  const isAllowed = ALLOWED_TYPES.some((t) => fileType.startsWith(t));
  if (!isAllowed) throw Errors.Validation("File type not allowed");
  if (fileSize > MAX_FILE_SIZE) throw Errors.Validation("File size exceeds 50MB limit");

  const uploader = await prisma.user.findUnique({ where: { id: uploaderId } });
  if (!uploader) throw Errors.NotFound("Uploader not found");

  const resource = await prisma.resource.create({
    data: {
      uploaderId,
      institutionId,
      title,
      description,
      tags,
      fileUrl,
      fileType,
      fileSize,
    },
  });

  logger.info(`📤 Resource uploaded: ${title} by ${uploader.username}`);
  return resource;
};

/**
 * 📚 Get all resources with filters & pagination
 * Supports search, tag filtering, and institutional access scope.
 */
export const getResources = async (query: GetResourcesQuery) => {
  const { search, tag, institutionId } = query;

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { tags: { has: search.toLowerCase() } },
    ];
  }
  if (tag) where.tags = { has: tag.toLowerCase() };
  if (institutionId) where.institutionId = institutionId;

  const { prismaArgs, meta } = await paginate(query, "offset", {
    where,
    countFn: (w) => prisma.resource.count({ where: w }),
    includeTotal: true,
  });

  const resources = await prisma.resource.findMany({
    ...prismaArgs,
    where,
    orderBy: { createdAt: "desc" },
    include: {
      uploader: { select: { id: true, username: true, name: true, role: true } },
      institution: { select: { id: true, name: true } },
    },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(resources as any);

  return { data: resources, meta };
};

/**
 * 🧾 Get a single resource by ID
 */
export const getResourceById = async (id: string) => {
  const resource = await prisma.resource.findUnique({
    where: { id },
    include: {
      uploader: { select: { id: true, username: true, name: true } },
      institution: { select: { id: true, name: true } },
    },
  });

  if (!resource) throw Errors.NotFound("Resource not found");
  return resource;
};

/**
 * ✏️ Update resource metadata (title, description, tags)
 */
export const updateResource = async (id: string, updaterId: string, data: UpdateResourceInput) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw Errors.NotFound("Resource not found");

  // Only uploader or admin can update
  const updater = await prisma.user.findUnique({ where: { id: updaterId } });
  if (!updater || (updater.role !== "admin" && updater.id !== resource.uploaderId))
    throw Errors.Forbidden("Not authorized to update this resource");

  const updated = await prisma.resource.update({
    where: { id },
    data: {
      title: data.title ?? resource.title,
      description: data.description ?? resource.description,
      tags: data.tags?.map((t) => t.toLowerCase()) ?? resource.tags,
    },
  });

  logger.info(`✏️ Resource updated: ${id} by ${updater.username}`);
  return updated;
};

/**
 * 🗑️ Delete resource (with S3 cleanup)
 */
export const deleteResource = async (id: string, requesterId: string) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw Errors.NotFound("Resource not found");

  const user = await prisma.user.findUnique({ where: { id: requesterId } });
  if (!user || (user.id !== resource.uploaderId && user.role !== "admin"))
    throw Errors.Forbidden("Not authorized to delete resource");

  // Delete file from storage (S3)
  try {
    await deleteFromS3(resource.fileUrl);
  } catch (err) {
    logger.warn(`⚠️ Failed to delete file from storage: ${err}`);
  }

  await prisma.resource.delete({ where: { id } });

  logger.warn(`🗑️ Resource ${id} deleted by ${user.username}`);
  return { success: true, message: "Resource deleted successfully" };
};

/**
 * 🧠 Future Enhancements
 * ----------------------
 * - AI-based tagging/classification (lib/ai/aiClient.ts)
 * - Version control (auto-create new record for each upload update)
 * - Download tracking (audit logs)
 * - Institution resource sharing policies
 * - Scheduled resource cleanup worker
 */