/**
 * src/routes/superAdmin/alerts.ts
 * ---------------------------------------------------------------------
 * 🔔 Super Admin Alerts Routes
 * ---------------------------------------------------------------------
 * Handles:
 *  - Viewing system and security alerts
 *  - Acknowledging / resolving alerts
 *  - Triggering re-checks or rescans
 *  - Sending broadcast notifications to admins
 * 
 * Security:
 *  - Super admin access only
 *  - MFA enforced at token level
 *  - Full audit logging for each operation
 * ---------------------------------------------------------------------
 */

import express from "express";
import {
  getAllAlerts,
  resolveAlert,
  resendAlertNotification,
  triggerAlertRecheck,
  clearResolvedAlerts,
  getAlertStats,
} from "../../controllers/superAdmin/alerts.controller";

import { superAuth } from "../../middleware/superAuth.middleware";
import { recordAudit } from "../../middleware/audit.middleware";
import { rateLimiter } from "../../middleware/rateLimiter.middleware";

const router = express.Router();

/* ---------------------------------------------------------------------
   🧱 Security Middlewares
--------------------------------------------------------------------- */

router.use(superAuth); // Enforces JWT + super_admin + MFA
router.use(rateLimiter); // Prevents spam or mass triggering

/* ---------------------------------------------------------------------
   📡 Alert Management Endpoints
--------------------------------------------------------------------- */

// 📊 Get all system alerts (with optional filters)
router.get("/", recordAudit("ALERTS_VIEW_ALL"), getAllAlerts);

// ✅ Resolve / acknowledge an alert
router.post("/resolve/:id", recordAudit("ALERT_RESOLVE"), resolveAlert);

// 🔁 Trigger re-check for a specific alert (manual re-scan)
router.post("/recheck/:id", recordAudit("ALERT_RECHECK"), triggerAlertRecheck);

// 📤 Re-send an alert notification (email/push)
router.post("/resend/:id", recordAudit("ALERT_RESEND_NOTIFICATION"), resendAlertNotification);

// 🧹 Clear all resolved alerts (cleanup)
router.delete("/clear-resolved", recordAudit("ALERTS_CLEAR_RESOLVED"), clearResolvedAlerts);

// 📈 Get system alert statistics (active, resolved, severity, etc.)
router.get("/stats", recordAudit("ALERTS_STATS_VIEW"), getAlertStats);

export default router;