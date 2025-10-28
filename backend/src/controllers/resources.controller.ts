/**
 * src/controllers/resources.controller.ts
 * ---------------------------------------------------------
 * Handles all resource operations (upload, list, view, delete).
 * - Supports file + URL uploads (S3, videos, docs, PDFs)
 * - Role-secure access control (admin/coach → share; athlete → view)
 * - Fully paginated and scalable
 * - Metadata captured for analytics & AI recommendations
 * ---------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";
import { getSignedUrl, deleteS3Object } from "../integrations/s3";

/* ------------------------------------------------------------------
   📤 Upload / Create Resource (coach/admin)
-------------------------------------------------------------------*/
export const createResource = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth("Authentication required.");

    const { title, description, fileUrl, category, visibility, tags, institutionId } = req.body;

    if (!title || !fileUrl)
      throw Errors.Validation("Both title and file URL are required.");

    // Restrict access — only admins/coaches can upload
    if (!["coach", "admin"].includes(user.role))
      throw Errors.Forbidden("Only coaches or admins can upload resources.");

    const resource = await prisma.resource.create({
      data: {
        title,
        description,
        fileUrl,
        category,
        visibility: visibility ?? "institution", // 'public' | 'institution' | 'private'
        tags,
        uploadedById: user.id,
        institutionId: institutionId ?? user.institutionId,
      },
    });

    logger.info(`📁 Resource created by ${user.id}: ${title}`);
    res.status(201).json({
      success: true,
      message: "Resource uploaded successfully.",
      data: resource,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📚 List / Search Resources (with filters + pagination)
-------------------------------------------------------------------*/
export const listResources = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth();

    const { q, category, uploaderId, visibility } = req.query;

    const where: any = {};

    // Access control logic
    if (user.role === "athlete") {
      // Athletes can only view resources within their institution or public
      where.OR = [
        { visibility: "public" },
        { visibility: "institution", institutionId: user.institutionId },
      ];
    } else if (user.role === "coach") {
      // Coaches see institution + their own uploads
      where.OR = [
        { uploadedById: user.id },
        { institutionId: user.institutionId },
      ];
    }

    if (category) where.category = String(category);
    if (visibility) where.visibility = String(visibility);
    if (uploaderId) where.uploadedById = String(uploaderId);
    if (q) where.title = { contains: String(q), mode: "insensitive" };

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.resource.count({ where }),
      where,
    });

    const resources = await prisma.resource.findMany({
      ...prismaArgs,
      where,
      include: {
        uploadedBy: {
          select: { id: true, name: true, role: true, institutionId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: resources, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Single Resource (with access validation)
-------------------------------------------------------------------*/
export const getResourceById = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    });

    if (!resource) throw Errors.NotFound("Resource not found.");

    // Access control
    if (resource.visibility === "private" && resource.uploadedById !== user?.id)
      throw Errors.Forbidden("You are not authorized to view this resource.");

    if (
      resource.visibility === "institution" &&
      resource.institutionId !== user?.institutionId &&
      user?.role !== "admin"
    )
      throw Errors.Forbidden("You are not part of this institution.");

    res.json({ success: true, data: resource });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧾 Generate Presigned URL (for upload to S3)
-------------------------------------------------------------------*/
export const generateUploadUrl = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth();

    const { filename, contentType } = req.body;
    if (!filename || !contentType)
      throw Errors.Validation("Filename and content type are required.");

    const signedUrl = await getSignedUrl(filename, contentType);

    res.json({ success: true, data: { uploadUrl: signedUrl } });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ❌ Delete Resource (admin or uploader only)
-------------------------------------------------------------------*/
export const deleteResource = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({ where: { id } });
    if (!resource) throw Errors.NotFound("Resource not found.");

    // Only uploader or admin can delete
    if (resource.uploadedById !== user?.id && user?.role !== "admin")
      throw Errors.Forbidden("You do not have permission to delete this resource.");

    await prisma.resource.delete({ where: { id } });

    // Optional: remove from S3 if fileUrl is an S3 object
    if (resource.fileUrl?.includes("s3.amazonaws.com")) {
      try {
        await deleteS3Object(resource.fileUrl);
      } catch (err) {
        logger.warn(`⚠️ Failed to delete S3 object: ${resource.fileUrl}`);
      }
    }

    res.json({ success: true, message: "Resource deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📈 Get Resource Stats (admin/coach)
-------------------------------------------------------------------*/
export const getResourceStats = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!["admin", "coach"].includes(user?.role ?? ""))
      throw Errors.Forbidden();

    const total = await prisma.resource.count({
      where: { institutionId: user.institutionId },
    });

    const recent = await prisma.resource.findMany({
      where: { institutionId: user.institutionId },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });

    res.json({
      success: true,
      data: {
        totalResources: total,
        recentUploads: recent,
      },
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};