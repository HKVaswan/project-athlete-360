/**
 * src/controllers/superAdmin/consumers.controller.ts
 * -----------------------------------------------------------------------------
 * 🧠 Super Admin Consumers Controller
 * Provides high-level visibility and safe administrative control over all
 * consuming entities (institutions, coaches, athletes).
 *
 * Core Functions:
 *  - List and filter all consumers by plan, usage, or risk level
 *  - Inspect full account health (quota, storage, billing, abuse status)
 *  - Flag suspicious activity and trigger anti-abuse audits
 *  - Soft-suspend / restore institutions or users
 *  - Export consumption summaries for analysis
 * -----------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import logger from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { getUsageProjection } from "../../lib/usageProjection";
import { superAdminAlerts } from "../../services/superAdminAlerts.service";
import { auditService } from "../../lib/audit";
import { detectTrialAbuse } from "../../services/trialAudit.service";

/* -----------------------------------------------------------------------
   🧾 List all consumers (with advanced filters)
------------------------------------------------------------------------*/
export const listConsumers = async (req: Request, res: Response) => {
  try {
    const { type, planStatus, search, sort = "createdAt", order = "desc", limit = 25, page = 1 } =
      req.query as Record<string, string>;

    const where: any = {};

    if (type === "institution") where.role = "institution_admin";
    else if (type === "coach") where.role = "coach";
    else if (type === "athlete") where.role = "athlete";

    if (planStatus === "trial") where.trialActive = true;
    if (planStatus === "expired") where.planExpired = true;

    if (search) {
      const s = search.trim().toLowerCase();
      where.OR = [
        { username: { contains: s, mode: "insensitive" } },
        { email: { contains: s, mode: "insensitive" } },
        { name: { contains: s, mode: "insensitive" } },
      ];
    }

    const consumers = await prisma.user.findMany({
      where,
      include: {
        institution: { select: { id: true, name: true } },
        subscription: true,
        quota: true,
      },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
      orderBy: { [sort]: order },
    });

    const data = consumers.map((c) => ({
      id: c.id,
      username: c.username,
      name: c.name,
      role: c.role,
      email: c.email,
      institution: c.institution?.name || null,
      plan: c.subscription?.planName || "Free",
      trialActive: c.subscription?.trialActive || false,
      planExpiresAt: c.subscription?.expiresAt || null,
      quota: {
        used: c.quota?.used ?? 0,
        limit: c.quota?.limit ?? 0,
        utilization:
          c.quota && c.quota.limit > 0
            ? Math.round((c.quota.used / c.quota.limit) * 100)
            : 0,
      },
    }));

    res.json({
      success: true,
      meta: { page, limit, count: data.length },
      data,
    });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Failed to list consumers: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔍 Get detailed consumer insight
------------------------------------------------------------------------*/
export const getConsumerDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const consumer = await prisma.user.findUnique({
      where: { id },
      include: {
        subscription: true,
        quota: true,
        institution: true,
        athlete: true,
        coach: true,
      },
    });

    if (!consumer) throw Errors.NotFound("Consumer not found");

    const projection = await getUsageProjection(consumer.id);

    res.json({
      success: true,
      data: {
        consumer,
        usageProjection: projection,
      },
    });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Failed to fetch consumer detail: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚨 Flag or Unflag consumer for abuse
------------------------------------------------------------------------*/
export const flagConsumer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, severity = "medium" } = req.body;

    const consumer = await prisma.user.findUnique({ where: { id } });
    if (!consumer) throw Errors.NotFound("Consumer not found");

    await prisma.user.update({
      where: { id },
      data: { abuseFlagged: true, abuseReason: reason, abuseSeverity: severity },
    });

    await superAdminAlerts.createAlert({
      type: "abuse_flagged",
      targetId: id,
      message: `User ${consumer.username} flagged for ${reason}`,
      severity,
    });

    await auditService.log({
      actorRole: "super_admin",
      action: "ABUSE_FLAG",
      targetId: id,
      details: { reason, severity },
    });

    res.json({
      success: true,
      message: `Consumer ${consumer.username} flagged successfully.`,
    });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Failed to flag consumer: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ♻️ Restore (Unflag) consumer
------------------------------------------------------------------------*/
export const unflagConsumer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const consumer = await prisma.user.findUnique({ where: { id } });
    if (!consumer) throw Errors.NotFound("Consumer not found");

    await prisma.user.update({
      where: { id },
      data: { abuseFlagged: false, abuseReason: null, abuseSeverity: null },
    });

    await auditService.log({
      actorRole: "super_admin",
      action: "ABUSE_RESTORED",
      targetId: id,
    });

    res.json({
      success: true,
      message: `Consumer ${consumer.username} unflagged successfully.`,
    });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Failed to unflag consumer: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧩 Detect Trial Abuse (manual trigger)
------------------------------------------------------------------------*/
export const detectTrialReuse = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await detectTrialAbuse(userId);

    if (result.flagged) {
      await superAdminAlerts.createAlert({
        type: "trial_abuse_detected",
        targetId: userId,
        message: `Trial reuse detected for ${userId}`,
        severity: "high",
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Trial audit failed: ${err.message}`);
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📤 Export usage data snapshot
------------------------------------------------------------------------*/
export const exportConsumersReport = async (_req: Request, res: Response) => {
  try {
    const consumers = await prisma.user.findMany({
      include: {
        subscription: true,
        quota: true,
        institution: true,
      },
    });

    const report = consumers.map((c) => ({
      id: c.id,
      username: c.username,
      role: c.role,
      institution: c.institution?.name ?? null,
      plan: c.subscription?.planName ?? "Free",
      expiresAt: c.subscription?.expiresAt ?? null,
      quotaUsed: c.quota?.used ?? 0,
      quotaLimit: c.quota?.limit ?? 0,
      flagged: c.abuseFlagged ?? false,
    }));

    res.setHeader("Content-Disposition", "attachment; filename=consumers_report.json");
    res.json({ success: true, data: report });
  } catch (err: any) {
    logger.error(`[SUPERADMIN] Failed to export report: ${err.message}`);
    sendErrorResponse(res, err);
  }
};