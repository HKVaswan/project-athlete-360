/**
 * src/routes/superAdmin/consumers.ts
 * -----------------------------------------------------------------------------
 * 🧠 Super Admin Consumer Management Routes
 * Provides secure endpoints for super admins to:
 *  - List all consumers (institutions, coaches, athletes)
 *  - Inspect detailed usage, plans, and quotas
 *  - Flag or unflag abuse
 *  - Detect trial misuse
 *  - Export audit-ready reports
 * -----------------------------------------------------------------------------
 */

import { Router } from "express";
import {
  listConsumers,
  getConsumerDetail,
  flagConsumer,
  unflagConsumer,
  detectTrialReuse,
  exportConsumersReport,
} from "../../controllers/superAdmin/consumers.controller";
import { requireAuth, requireSuperAdmin } from "../../middleware/auth.middleware";
import { z } from "zod";
import { validateRequest } from "../../middleware/validate.middleware";

const router = Router();

// ─────────────────────────────────────────────────────────────
// 🧩 Validation Schemas
// ─────────────────────────────────────────────────────────────
const ListConsumersSchema = z.object({
  query: z.object({
    type: z.enum(["institution", "coach", "athlete"]).optional(),
    planStatus: z.enum(["trial", "active", "expired"]).optional(),
    search: z.string().optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.coerce.number().max(100).default(25),
    page: z.coerce.number().default(1),
  }),
});

const FlagConsumerSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    reason: z.string().min(3, "Reason required"),
    severity: z.enum(["low", "medium", "high"]).default("medium"),
  }),
});

const UnflagConsumerSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const DetectTrialReuseSchema = z.object({
  params: z.object({
    userId: z.string().uuid(),
  }),
});

// ─────────────────────────────────────────────────────────────
// 🧠 Routes
// ─────────────────────────────────────────────────────────────

// 🔍 List all consumers (with filters, pagination)
router.get(
  "/",
  requireAuth,
  requireSuperAdmin,
  validateRequest(ListConsumersSchema),
  listConsumers
);

// 📊 Get detailed consumer info
router.get(
  "/:id",
  requireAuth,
  requireSuperAdmin,
  getConsumerDetail
);

// 🚨 Flag a consumer for abuse
router.post(
  "/:id/flag",
  requireAuth,
  requireSuperAdmin,
  validateRequest(FlagConsumerSchema),
  flagConsumer
);

// ♻️ Unflag a consumer
router.post(
  "/:id/unflag",
  requireAuth,
  requireSuperAdmin,
  validateRequest(UnflagConsumerSchema),
  unflagConsumer
);

// 🧩 Detect trial reuse or abuse
router.post(
  "/:userId/trial-audit",
  requireAuth,
  requireSuperAdmin,
  validateRequest(DetectTrialReuseSchema),
  detectTrialReuse
);

// 📤 Export JSON report of consumers
router.get(
  "/export/report",
  requireAuth,
  requireSuperAdmin,
  exportConsumersReport
);

export default router;