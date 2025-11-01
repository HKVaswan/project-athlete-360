/**
 * src/controllers/superAdmin/alerts.controller.ts
 * ---------------------------------------------------------------------
 * Super Admin Alerts Controller
 *
 * Responsibilities:
 *  - View & manage all system alerts (performance, security, quota, billing)
 *  - Mark alerts as read/resolved
 *  - Trigger manual alert broadcasts to admins/institutions
 *  - Fully auditable and restricted to "super_admin" role
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { prisma } from "../../prismaClient";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { emitSocketNotification } from "../../lib/socket";
import { auditService } from "../../services/audit.service";
import { superAdminAlertsService } from "../../services/superAdminAlerts.service";

/* ---------------------------------------------------------------
   🧱 Utility: Verify Super Admin Access
----------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied. Super admin privileges required.");
  }
  return user;
};

/* ---------------------------------------------------------------
   📋 1. Get All Active Alerts
----------------------------------------------------------------*/
export const getActiveAlerts = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const alerts = await prisma.systemAlert.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_ACTIVE_ALERTS",
      details: { count: alerts.length },
      ip: req.ip,
    });

    res.json({
      success: true,
      data: alerts,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🧾 2. Get Alert History (Paginated)
----------------------------------------------------------------*/
export const getAlertHistory = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const limit = Number(req.query.limit) || 50;

    const alerts = await prisma.systemAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_ALERT_HISTORY",
      details: { limit },
      ip: req.ip,
    });

    res.json({
      success: true,
      data: alerts,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   ✅ 3. Mark Alert as Resolved
----------------------------------------------------------------*/
export const resolveAlert = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { alertId } = req.body;

    const alert = await prisma.systemAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw Errors.NotFound("Alert not found.");

    const updated = await prisma.systemAlert.update({
      where: { id: alertId },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: superAdmin.id },
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "RESOLVE_ALERT",
      details: { alertId },
      ip: req.ip,
    });

    logger.info(`[ALERT] ✅ Alert ${alertId} marked as resolved by ${superAdmin.email}`);

    res.json({
      success: true,
      message: "Alert marked as resolved.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🚨 4. Trigger Manual Alert Broadcast
----------------------------------------------------------------*/
export const broadcastAlert = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { title, body, severity = "medium", recipients = "admins" } = req.body;

    if (!title || !body) throw Errors.Validation("Title and body are required.");

    // Save to system alert table
    const alert = await prisma.systemAlert.create({
      data: {
        title,
        body,
        severity,
        createdBy: superAdmin.id,
      },
    });

    // Dispatch through service (socket, email, etc.)
    await superAdminAlertsService.broadcastAlert({
      title,
      body,
      severity,
      recipients,
      triggeredBy: superAdmin.id,
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "BROADCAST_ALERT",
      details: { title, severity, recipients },
      ip: req.ip,
    });

    res.json({
      success: true,
      message: "Alert broadcast successfully.",
      data: alert,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🧠 5. Get System Health Summary (Aggregated)
----------------------------------------------------------------*/
export const getSystemHealthSummary = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const health = await superAdminAlertsService.generateHealthSummary();

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_HEALTH_SUMMARY",
      details: { report: health },
      ip: req.ip,
    });

    res.json({
      success: true,
      message: "System health summary generated.",
      data: health,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};