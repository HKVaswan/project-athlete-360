// src/routes/superAdmin.ts
/**
 * superAdmin.ts
 * ----------------------------------------------------------------------
 * Secure routes for all Super Admin operations
 *
 * Includes:
 *  - System health, backup, and restore
 *  - Audit logs and impersonation
 *  - Secret management
 *  - AI status and platform overview
 *
 * Middleware:
 *  - requireAuth: verifies token validity
 *  - requireRole(["super_admin"]): restricts route access
 *  - MFA verification required via decoded token
 *
 * Notes:
 *  - All actions are logged in the audit trail.
 *  - All routes require Bearer token (JWT).
 * ----------------------------------------------------------------------
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import * as systemController from "../controllers/superAdmin/system.controller";
import * as auditController from "../controllers/superAdmin/audit.controller";
import * as impersonationController from "../controllers/superAdmin/impersonation.controller";
import * as secretController from "../controllers/superAdmin/secret.controller";
import * as superAdminAuthController from "../controllers/superAdmin/auth.controller";

const router = Router();

// ───────────────────────────────
// 🧠 AUTHENTICATION
// ───────────────────────────────
router.post("/login", superAdminAuthController.login);
router.post("/mfa/verify", superAdminAuthController.verifyMFA);
router.post("/mfa/resend", superAdminAuthController.resendMFA);
router.post("/logout", requireAuth, requireRole(["super_admin"]), superAdminAuthController.logout);

// ───────────────────────────────
// 🖥 SYSTEM CONTROL
// ───────────────────────────────
router.get(
  "/system/status",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.getSystemStatus
);

router.post(
  "/system/backup",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.triggerBackup
);

router.post(
  "/system/restore",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.restoreFromBackup
);

router.get(
  "/system/backups",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.getBackupHistory
);

router.get(
  "/system/overview",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.getSystemOverview
);

router.get(
  "/system/ai-status",
  requireAuth,
  requireRole(["super_admin"]),
  systemController.getAIStatus
);

// ───────────────────────────────
// 📜 AUDIT & LOGS
// ───────────────────────────────
router.get(
  "/audit/logs",
  requireAuth,
  requireRole(["super_admin"]),
  auditController.getAuditLogs
);

router.get(
  "/audit/activity-summary",
  requireAuth,
  requireRole(["super_admin"]),
  auditController.getActivitySummary
);

router.delete(
  "/audit/purge",
  requireAuth,
  requireRole(["super_admin"]),
  auditController.purgeOldAuditLogs
);

// ───────────────────────────────
// 🧍 IMPERSONATION CONTROL
// ───────────────────────────────
router.post(
  "/impersonate/start",
  requireAuth,
  requireRole(["super_admin"]),
  impersonationController.startImpersonation
);

router.post(
  "/impersonate/stop",
  requireAuth,
  requireRole(["super_admin"]),
  impersonationController.stopImpersonation
);

router.get(
  "/impersonate/active",
  requireAuth,
  requireRole(["super_admin"]),
  impersonationController.getActiveImpersonations
);

// ───────────────────────────────
// 🔐 SECRET MANAGEMENT
// ───────────────────────────────
router.get(
  "/secrets",
  requireAuth,
  requireRole(["super_admin"]),
  secretController.listSecrets
);

router.post(
  "/secrets",
  requireAuth,
  requireRole(["super_admin"]),
  secretController.createSecret
);

router.delete(
  "/secrets/:key",
  requireAuth,
  requireRole(["super_admin"]),
  secretController.deleteSecret
);

// ───────────────────────────────
// ✅ HEALTH CHECK (Optional external)
router.get("/ping", (_req, res) => {
  res.json({ status: "SuperAdmin service online" });
});

export default router;