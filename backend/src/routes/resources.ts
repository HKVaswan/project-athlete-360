/**
 * src/routes/resources.ts
 * ---------------------------------------------------------
 * Routes for managing learning materials, media, and shared files.
 * Roles:
 *  - Admin & Coach: create, edit, delete
 *  - Athlete: view and download
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as resourceController from "../controllers/resources.controller";
import {
  createResourceSchema,
  updateResourceSchema,
} from "../validators/resources.validator";
import multer from "multer";

const router = Router();

// Use multer for multipart/form-data (file uploads)
const upload = multer({
  storage: multer.memoryStorage(), // Can later integrate AWS S3 or Cloudinary
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit per file
});

/**
 * 🔒 All resource routes require authentication
 */
router.use(requireAuth);

/**
 * ➕ Upload a new resource (document/video/guide)
 * Accessible by: Admin, Coach
 */
router.post(
  "/upload",
  requireRole(["admin", "coach"]),
  upload.single("file"),
  validate(createResourceSchema),
  resourceController.uploadResource
);

/**
 * 📚 Get all available resources
 * Accessible by: All authenticated users
 * Optional filters: ?category=, ?coachId=, ?institutionId=
 */
router.get("/", resourceController.getAllResources);

/**
 * 🔍 Get resource details by ID
 */
router.get("/:id", resourceController.getResourceById);

/**
 * 📝 Update a resource (metadata, tags, etc.)
 * Accessible by: Admin, Coach
 */
router.patch(
  "/:id",
  requireRole(["admin", "coach"]),
  validate(updateResourceSchema),
  resourceController.updateResource
);

/**
 * ❌ Delete a resource
 * Accessible by: Admin, Coach
 */
router.delete(
  "/:id",
  requireRole(["admin", "coach"]),
  resourceController.deleteResource
);

/**
 * ⬇️ Download or stream resource
 * (Could later support signed URL for private content)
 */
router.get("/:id/download", requireAuth, resourceController.downloadResource);

export default router;