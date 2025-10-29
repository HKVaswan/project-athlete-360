import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Resource Repository
 * ------------------------------------------------------------
 * Manages uploaded files, training materials, and shared documents.
 * Includes:
 *  - Secure upload & metadata storage
 *  - Version control
 *  - Role-based access (coach/admin/athlete)
 *  - Pagination-ready list queries
 *  - AI-friendly metadata design
 */
export const ResourceRepo = {
  /**
   * Create a new resource entry.
   * Handles versioning automatically if resource with same title exists.
   */
  async createResource(data: {
    title: string;
    description?: string;
    url: string;
    uploadedById: string;
    accessLevel?: "PUBLIC" | "PRIVATE" | "TEAM_ONLY";
    category?: string;
    metadata?: Record<string, any>;
  }) {
    try {
      const existing = await prisma.resource.findFirst({
        where: { title: data.title, uploadedById: data.uploadedById },
        orderBy: { version: "desc" },
      });

      const newVersion = existing ? existing.version + 1 : 1;

      const resource = await prisma.resource.create({
        data: {
          title: data.title,
          description: data.description ?? "",
          url: data.url,
          uploadedById: data.uploadedById,
          accessLevel: data.accessLevel ?? "PRIVATE",
          category: data.category ?? "General",
          version: newVersion,
          metadata: data.metadata ?? {},
        },
        include: {
          uploadedBy: { select: { id: true, name: true, role: true } },
        },
      });

      return resource;
    } catch (error) {
      console.error("❌ Error creating resource:", error);
      throw new Error("Failed to upload resource");
    }
  },

  /**
   * Get paginated list of resources (filtered by access level and category).
   */
  async listResources(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      category?: string;
      accessLevel?: "PUBLIC" | "PRIVATE" | "TEAM_ONLY";
    }
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 10;
    const skip = (page - 1) * limit;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, institutionId: true },
      });

      if (!user) throw new Error("User not found");

      const where: any = {};

      // Category filter
      if (options?.category) where.category = options.category;

      // Access control logic
      if (user.role === "ADMIN") {
        // admins see all
      } else if (user.role === "COACH") {
        where.OR = [
          { accessLevel: "PUBLIC" },
          { accessLevel: "TEAM_ONLY", uploadedBy: { institutionId: user.institutionId } },
          { uploadedById: userId },
        ];
      } else {
        // athlete
        where.OR = [
          { accessLevel: "PUBLIC" },
          { accessLevel: "TEAM_ONLY", uploadedBy: { institutionId: user.institutionId } },
        ];
      }

      const [resources, total] = await Promise.all([
        prisma.resource.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            uploadedBy: { select: { id: true, name: true, role: true } },
          },
        }),
        prisma.resource.count({ where }),
      ]);

      return {
        resources,
        pagination: {
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ Error listing resources:", error);
      throw new Error("Failed to fetch resources");
    }
  },

  /**
   * Get resource details with access validation.
   */
  async getResourceById(resourceId: string, userId: string) {
    try {
      const resource = await prisma.resource.findUnique({
        where: { id: resourceId },
        include: {
          uploadedBy: { select: { id: true, name: true, role: true, institutionId: true } },
        },
      });
      if (!resource) throw new Error("Resource not found");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, institutionId: true },
      });
      if (!user) throw new Error("User not found");

      // Validate access
      if (resource.accessLevel === "PRIVATE" && resource.uploadedById !== userId) {
        throw new Error("Access denied");
      }
      if (
        resource.accessLevel === "TEAM_ONLY" &&
        resource.uploadedBy.institutionId !== user.institutionId
      ) {
        throw new Error("Access denied");
      }

      return resource;
    } catch (error) {
      console.error("❌ Error getting resource:", error);
      throw new Error("Failed to fetch resource");
    }
  },

  /**
   * Delete a resource (soft delete to keep versioning integrity).
   */
  async deleteResource(resourceId: string, userId: string) {
    try {
      const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
      if (!resource) throw new Error("Resource not found");
      if (resource.uploadedById !== userId) throw new Error("Unauthorized delete attempt");

      await prisma.resource.update({
        where: { id: resourceId },
        data: { deleted: true },
      });

      return { success: true };
    } catch (error) {
      console.error("❌ Error deleting resource:", error);
      throw new Error("Failed to delete resource");
    }
  },
};