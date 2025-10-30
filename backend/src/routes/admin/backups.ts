/**
 * src/routes/admin/backups.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade Admin Backup Routes
 *
 * Exposes secure endpoints for:
 *  - Initiating backups
 *  - Restoring from backup
 *  - Viewing backup history
 *  - System health checks
 *  - Deleting old backups
 *
 * Features:
 *  - Strict admin-only access
 *  - Token authentication & role enforcement
 *  - API documentation-friendly route grouping
 */

import { Router } from "express";
import {
  startBackup,
  startRestore,
  getBackupHistory,
  getBackupHealth,
  deleteBackup,
} from "../../controllers/admin/backup.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/roles.middleware";

const router = Router();

/**
 * Protect all routes with authentication + ADMIN role
 */
router.use(authenticate, requireRole("ADMIN"));

/**
 * @route   POST /api/admin/backups/start
 * @desc    Trigger a full backup process
 * @access  Admin
 */
router.post("/start", startBackup);

/**
 * @route   POST /api/admin/backups/restore
 * @desc    Trigger restore from a specific backup key
 * @access  Admin
 */
router.post("/restore", startRestore);

/**
 * @route   GET /api/admin/backups/history
 * @desc    Fetch recent backup & restore logs
 * @access  Admin
 */
router.get("/history", getBackupHistory);

/**
 * @route   GET /api/admin/backups/health
 * @desc    Backup subsystem + Redis worker health check
 * @access  Admin
 */
router.get("/health", getBackupHealth);

/**
 * @route   DELETE /api/admin/backups/:backupKey
 * @desc    Delete a specific backup (cleanup)
 * @access  Admin
 */
router.delete("/:backupKey", deleteBackup);

/**
 * Module export
 */
export default router;