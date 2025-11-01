/**
 * src/services/resource.service.ts
 * ---------------------------------------------------------------------------
 * Resource Service — Enterprise Edition
 * ---------------------------------------------------------------------------
 * Responsibilities:
 *  - Secure file & resource management
 *  - Enforces plan-based quotas (storage, upload size, resource count)
 *  - Automatic S3/Cloud cleanup
 *  - Full audit trail for compliance
 *  - AI-ready metadata tagging & versioning support
 * ---------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate, computeNextCursor } from "../utils/pagination";
import { uploadToS3, deleteFromS3 } from "../integrations/s3";
import { quotaService } from "./quota.service";
import { recordAuditEvent } from "./audit.service";

type UploadResourceInput = {
  uploaderId: string;
  institutionId: string;
  title: string;
  description?: string;
  tags?: string[];
  fileUrl: string;
  fileType: string;
  fileSize: number;
  visibility?: "private" | "institution" | "public";
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
  visibility?: "private" | "institution" | "public";
};

/* ---------------------------------------------------------------------------
   🧩 Upload new resource — Enforces Plan Limits + Audit Trail
--------------------------------------------------------------------------- */
export const uploadResource = async (payload: UploadResourceInput) => {
  const { uploaderId, institutionId, title, description, tags, fileUrl, fileType, fileSize, visibility } = payload;

  if (!uploaderId || !institutionId || !title || !fileUrl || !fileType) {
    throw Errors.Validation("Missing required fields for resource upload");
  }

  // File validation
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = [
    "image/",
    "video/",
    "application/pdf",
    "application/msword",
    "text/plain",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument"
  ];
  const isAllowed = ALLOWED_TYPES.some((t) => fileType.startsWith(t));
  if (!isAllowed) throw Errors.Validation("File type not allowed");
  if (fileSize > MAX_FILE_SIZE) throw Errors.Validation("File size exceeds 100MB limit");

  // Validate uploader and institution
  const uploader = await prisma.user.findUnique({ where: { id: uploaderId } });
  if (!uploader) throw Errors.NotFound("Uploader not found");

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  // Enforce quota limits
  await quotaService.ensureWithinQuota(institutionId, "resources", fileSize);

  // Create resource
  const resource = await prisma.resource.create({
    data: {
      uploaderId,
      institutionId,
      title,
      description,
      tags: tags?.map((t) => t.toLowerCase()) || [],
      fileUrl,
      fileType,
      fileSize,
      visibility: visibility || "institution",
    },
  });

  // Record audit event
  await recordAuditEvent({
    actorId: uploaderId,
    actorRole: uploader.role,
    action: "RESOURCE_UPLOAD",
    ip: undefined,
    details: { title, fileSize, institutionId },
  });

  logger.info(`📤 Resource uploaded: ${title} by ${uploader.username}`);
  return resource;
};

/* ---------------------------------------------------------------------------
   📚 List resources — Supports search, filters, pagination
--------------------------------------------------------------------------- */
export const getResources = async (query: GetResourcesQuery, requester?: { id: string; role: string; institutionId?: string }) => {
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

  // Enforce institution scope unless super_admin
  if (requester?.role !== "super_admin") {
    where.institutionId = requester?.institutionId || institutionId;
  }

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

/* ---------------------------------------------------------------------------
   🧾 Get single resource (secure visibility enforcement)
--------------------------------------------------------------------------- */
export const getResourceById = async (id: string, requester?: { id: string; role: string; institutionId?: string }) => {
  const resource = await prisma.resource.findUnique({
    where: { id },
    include: {
      uploader: { select: { id: true, username: true, name: true } },
      institution: { select: { id: true, name: true } },
    },
  });

  if (!resource) throw Errors.NotFound("Resource not found");

  // Enforce visibility
  if (
    resource.visibility === "private" &&
    requester?.id !== resource.uploaderId &&
    requester?.role !== "admin" &&
    requester?.role !== "super_admin"
  ) {
    throw Errors.Forbidden("You are not authorized to view this resource");
  }

  if (
    resource.visibility === "institution" &&
    requester?.institutionId !== resource.institutionId &&
    requester?.role !== "super_admin"
  ) {
    throw Errors.Forbidden("Resource restricted to the same institution");
  }

  return resource;
};

/* ---------------------------------------------------------------------------
   ✏️ Update resource metadata (Uploader/Admin/SuperAdmin)
--------------------------------------------------------------------------- */
export const updateResource = async (id: string, updaterId: string, data: UpdateResourceInput) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw Errors.NotFound("Resource not found");

  const updater = await prisma.user.findUnique({ where: { id: updaterId } });
  if (!updater || (updater.id !== resource.uploaderId && !["admin", "super_admin"].includes(updater.role))) {
    throw Errors.Forbidden("Not authorized to update this resource");
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: {
      title: data.title ?? resource.title,
      description: data.description ?? resource.description,
      tags: data.tags?.map((t) => t.toLowerCase()) ?? resource.tags,
      visibility: data.visibility ?? resource.visibility,
    },
  });

  await recordAuditEvent({
    actorId: updater.id,
    actorRole: updater.role,
    action: "RESOURCE_UPDATE",
    details: { id, title: updated.title },
  });

  logger.info(`✏️ Resource updated: ${id} by ${updater.username}`);
  return updated;
};

/* ---------------------------------------------------------------------------
   🗑️ Delete resource — Enforces Ownership & Audit trail
--------------------------------------------------------------------------- */
export const deleteResource = async (id: string, requesterId: string) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw Errors.NotFound("Resource not found");

  const user = await prisma.user.findUnique({ where: { id: requesterId } });
  if (!user || (user.id !== resource.uploaderId && !["admin", "super_admin"].includes(user.role))) {
    throw Errors.Forbidden("Not authorized to delete this resource");
  }

  // Delete from S3
  try {
    await deleteFromS3(resource.fileUrl);
  } catch (err) {
    logger.warn(`⚠️ Failed to delete file from storage: ${err}`);
  }

  await prisma.resource.delete({ where: { id } });

  await recordAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "RESOURCE_DELETE",
    details: { id, title: resource.title },
  });

  logger.warn(`🗑️ Resource ${id} deleted by ${user.username}`);
  return { success: true, message: "Resource deleted successfully" };
};

/* ---------------------------------------------------------------------------
   🧠 Future Enhancements
--------------------------------------------------------------------------- */
// - AI-based tagging/classification via lib/ai/aiClient.ts
// - Download & view analytics (for insights & engagement)
// - Version control & auto cleanup for outdated files
// - Tiered access & sharing policies per subscription plan
// - Auto resource expiration for free-tier plans