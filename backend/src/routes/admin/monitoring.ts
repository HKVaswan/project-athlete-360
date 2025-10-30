/**
 * src/routes/admin/monitoring.ts
 * ---------------------------------------------------------------------------
 * Admin Monitoring Routes
 *
 * Provides:
 *  - Full system health report
 *  - Quick health check
 *  - Ping endpoint for uptime monitors
 *
 * Security:
 *  - Requires authenticated admin role
 */

import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/roles.middleware";
import {
  getSystemHealth,
  quickHealthCheck,
  ping,
} from "../../controllers/admin/monitoring.controller";

const router = Router();

/**
 * Protect all routes — only accessible by admins.
 */
router.use(authenticate, requireRole("ADMIN"));

/**
 * @route GET /api/admin/monitoring/ping
 * @desc Simple heartbeat check
 */
router.get("/ping", ping);

/**
 * @route GET /api/admin/monitoring/quick
 * @desc Lightweight database + queue check
 */
router.get("/quick", quickHealthCheck);

/**
 * @route GET /api/admin/monitoring/health
 * @desc Full system health report (CPU, Memory, DB, Workers)
 */
router.get("/health", getSystemHealth);

export default router;