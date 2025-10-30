/**
 * src/routes/admin/reports.ts
 * --------------------------------------------------------------------
 * Admin Reporting Routes
 *
 * Handles:
 *  - System overview report
 *  - Institution performance
 *  - Attendance statistics
 *  - CSV exports
 *
 * Features:
 *  - Role protection (admin-only)
 *  - Error-safe routing
 *  - Extendable for AI analytics reports in future
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/roles.middleware";
import {
  getSystemOverviewReport,
  getInstitutionPerformanceReport,
  getAttendanceReport,
  exportReportAsCSV,
} from "../../controllers/admin/reports.controller";

const router = Router();

// 🔒 All routes are protected and admin-only
router.use(requireAuth, requireRole("admin"));

// GET /admin/reports/overview
router.get("/overview", getSystemOverviewReport);

// GET /admin/reports/institution-performance
router.get("/institution-performance", getInstitutionPerformanceReport);

// GET /admin/reports/attendance
router.get("/attendance", getAttendanceReport);

// GET /admin/reports/export
router.get("/export", exportReportAsCSV);

export default router;