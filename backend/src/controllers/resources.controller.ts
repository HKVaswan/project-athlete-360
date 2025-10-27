import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { v4 as uuidv4 } from "uuid";

// ───────────────────────────────
// 📁 Helper to generate file metadata
const generateResourceCode = () => `RES-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// 📤 Upload or Create Resource
// Admins/Coaches can upload files or share URLs with athletes
export const uploadResource = async (req: Request, res: Response) => {
  try {
    const uploaderId = (req as any).userId;
    const { title, description, fileUrl, fileType, visibility, athleteIds, institutionId } =
      req.body;

    if (!title || !fileUrl || !fileType) {
      return res
        .status(400)
        .json({ success: false, message: "title, fileUrl, and fileType are required." });
    }

    const uploader = await prisma.user.findUnique({ where: { id: uploaderId } });
    if (!uploader)
      return res.status(404).json({ success: false, message: "Uploader not found." });

    // default to private unless explicitly made public
    const resource = await prisma.resource.create({
      data: {
        code: generateResourceCode(),
        title,
        description,
        fileUrl,
        fileType,
        uploaderId,
        institutionId: institutionId || null,
        visibility: visibility || "private",
        sharedWithAthletes: athleteIds
          ? {
              createMany: {
                data: athleteIds.map((athleteId: string) => ({
                  athleteId,
                })),
              },
            }
          : undefined,
      },
      include: { sharedWithAthletes: true },
    });

    res.status(201).json({
      success: true,
      message: "Resource uploaded successfully.",
      data: resource,
    });
  } catch (err) {
    logger.error("❌ uploadResource failed: " + err);
    res.status(500).json({ success: false, message: "Failed to upload resource." });
  }
};

// ───────────────────────────────
// 📚 List all resources (filter by institution, uploader, or visibility)
export const listResources = async (req: Request, res: Response) => {
  try {
    const { institutionId, uploaderId, visibility, page, limit } = req.query;

    const take = Number(limit) || 10;
    const skip = page ? (Number(page) - 1) * take : 0;

    const whereClause: any = {};
    if (institutionId) whereClause.institutionId = String(institutionId);
    if (uploaderId) whereClause.uploaderId = String(uploaderId);
    if (visibility) whereClause.visibility = String(visibility);

    const [resources, total] = await Promise.all([
      prisma.resource.findMany({
        where: whereClause,
        include: {
          uploader: { select: { id: true, username: true, role: true, name: true } },
          sharedWithAthletes: {
            include: {
              athlete: { select: { id: true, name: true, sport: true, athleteCode: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.resource.count({ where: whereClause }),
    ]);

    res.json({
      success: true,
      data: resources,
      meta: {
        total,
        page: Number(page) || 1,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    logger.error("❌ listResources failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch resources." });
  }
};

// ───────────────────────────────
// 👀 View resource by ID
export const getResourceById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        uploader: { select: { id: true, username: true, role: true, name: true } },
        sharedWithAthletes: {
          include: {
            athlete: { select: { id: true, name: true, sport: true, athleteCode: true } },
          },
        },
      },
    });

    if (!resource)
      return res.status(404).json({ success: false, message: "Resource not found." });

    res.json({ success: true, data: resource });
  } catch (err) {
    logger.error("❌ getResourceById failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch resource." });
  }
};

// ───────────────────────────────
// 🗂️ Share existing resource with additional athletes
export const shareResource = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { athleteIds } = req.body;

    if (!athleteIds || athleteIds.length === 0) {
      return res.status(400).json({ success: false, message: "athleteIds required." });
    }

    const resource = await prisma.resource.findUnique({ where: { id } });
    if (!resource)
      return res.status(404).json({ success: false, message: "Resource not found." });

    const shared = await prisma.sharedResource.createMany({
      data: athleteIds.map((athleteId: string) => ({
        resourceId: id,
        athleteId,
      })),
      skipDuplicates: true,
    });

    res.json({
      success: true,
      message: `Resource shared with ${shared.count} athlete(s).`,
    });
  } catch (err) {
    logger.error("❌ shareResource failed: " + err);
    res.status(500).json({ success: false, message: "Failed to share resource." });
  }
};

// ───────────────────────────────
// ✏️ Update resource details
export const updateResource = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, fileUrl, visibility } = req.body;

    const updated = await prisma.resource.update({
      where: { id },
      data: { title, description, fileUrl, visibility },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("❌ updateResource failed: " + err);
    res.status(500).json({ success: false, message: "Failed to update resource." });
  }
};

// ───────────────────────────────
// ❌ Delete resource
export const deleteResource = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.sharedResource.deleteMany({ where: { resourceId: id } });
    await prisma.resource.delete({ where: { id } });

    res.json({ success: true, message: "Resource deleted successfully." });
  } catch (err) {
    logger.error("❌ deleteResource failed: " + err);
    res.status(500).json({ success: false, message: "Failed to delete resource." });
  }
};

// ───────────────────────────────
// 🧑‍🎓 Get resources assigned to a specific athlete
export const getResourcesForAthlete = async (req: Request, res: Response) => {
  try {
    const { athleteId } = req.params;

    const resources = await prisma.sharedResource.findMany({
      where: { athleteId },
      include: {
        resource: {
          include: {
            uploader: { select: { id: true, username: true, role: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: resources.map((r) => ({
        id: r.resource.id,
        title: r.resource.title,
        description: r.resource.description,
        fileUrl: r.resource.fileUrl,
        fileType: r.resource.fileType,
        uploader: r.resource.uploader,
        sharedAt: r.createdAt,
      })),
    });
  } catch (err) {
    logger.error("❌ getResourcesForAthlete failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch athlete resources." });
  }
};