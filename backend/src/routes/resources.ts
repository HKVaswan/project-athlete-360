import express from "express";
import multer from "multer";
import {
  uploadResource,
  listResources,
  getResourceById,
  deleteResource,
  downloadResource,
} from "../controllers/resources.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = express.Router();

/**
 * ───────────────────────────────
 * 📘 Resource Management Routes
 * ───────────────────────────────
 *
 * Handles upload, access, and management of shared resources.
 * Access control:
 *  - Admins and Coaches: can upload, delete, manage
 *  - Athletes: can view and download
 */

// Configure multer for file uploads (temporary local storage)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 📤 Upload a new resource (coach or admin)
router.post("/", requireAuth, upload.single("file"), uploadResource);

// 📋 List all resources (optionally filter by uploader, sport, or institution)
router.get("/", requireAuth, listResources);

// 🔍 Get resource details by ID
router.get("/:id", requireAuth, getResourceById);

// 📥 Download resource file
router.get("/:id/download", requireAuth, downloadResource);

// 🗑️ Delete resource (only admin or uploader)
router.delete("/:id", requireAuth, deleteResource);

export default router;