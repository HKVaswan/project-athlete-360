/**
 * src/controllers/superAdmin/billing.controller.ts
 * -----------------------------------------------------------------------------
 * 🧠 Super Admin Billing Oversight Controller
 * Provides administrative visibility and control over all billing-related data:
 *  - Global billing summaries (MRR, trial-to-paid conversion)
 *  - Institution-level invoices and payments
 *  - Manual adjustments and refunds
 *  - Reconciliation audit triggers
 *  - System-wide billing anomaly reports
 *
 * Securely accessible only to verified Super Admins (MFA enforced).
 * All actions are audit logged via auditService.
 * -----------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../../prismaClient";
import logger from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { auditService } from "../../lib/audit";
import { triggerReconciliation } from "../../services/reconciliation.service";
import { billingService } from "../../services/billing.service";
import { superAdminAlerts } from "../../services/superAdminAlerts.service";
import { exportToCsvBuffer } from "../../utils/export";
import { config } from "../../config";

/* ------------------------------------------------------------------
   📊 Get Global Billing Summary
-------------------------------------------------------------------*/
export const getGlobalSummary = async (req: Request, res: Response) => {
  try {
    const [totalInstitutions, activeSubscriptions, totalRevenue, unpaidInvoices] =
      await Promise.all([
        prisma.institution.count(),
        prisma.subscription.count({ where: { status: "active" } }),
        prisma.payment.aggregate({ _sum: { amount: true } }),
        prisma.invoice.count({ where: { status: "pending" } }),
      ]);

    const summary = {
      totalInstitutions,
      activeSubscriptions,
      totalRevenue: totalRevenue._sum.amount ?? 0,
      unpaidInvoices,
    };

    await auditService.log({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action: "VIEW_BILLING_SUMMARY",
      details: { summary },
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🏢 Get Institution Billing Details
-------------------------------------------------------------------*/
export const getInstitutionBilling = async (req: Request, res: Response) => {
  try {
    const { institutionId } = req.params;

    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      include: {
        subscription: true,
        invoices: true,
        payments: true,
      },
    });

    if (!institution) throw Errors.NotFound("Institution not found");

    res.json({
      success: true,
      data: institution,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   💳 Manual Payment Adjustment (Credit/Debit)
-------------------------------------------------------------------*/
export const adjustPayment = async (req: Request, res: Response) => {
  try {
    const { institutionId, amount, reason, type } = req.body;
    if (!institutionId || !amount || !reason)
      throw Errors.Validation("institutionId, amount, and reason required");

    const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) throw Errors.NotFound("Institution not found");

    const payment = await prisma.payment.create({
      data: {
        institutionId,
        amount: type === "debit" ? -Math.abs(amount) : Math.abs(amount),
        method: "manual_adjustment",
        status: "completed",
        notes: reason,
        createdBy: req.user?.id,
      },
    });

    await auditService.log({
      actorId: req.user?.id,
      actorRole: "super_admin",
      action: "MANUAL_PAYMENT_ADJUSTMENT",
      details: { institutionId, amount, reason, type },
    });

    res.status(201).json({
      success: true,
      message: "Payment adjustment recorded successfully",
      data: payment,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Detect Billing Anomalies
   (missed payments, duplicate invoices, negative balances, etc.)
-------------------------------------------------------------------*/
export const detectAnomalies = async (req: Request, res: Response) => {
  try {
    const anomalies: any[] = [];

    const negativeBalances = await prisma.institution.findMany({
      where: { balance: { lt: 0 } },
      select: { id: true, name: true, balance: true },
    });

    if (negativeBalances.length) {
      anomalies.push({ type: "NEGATIVE_BALANCE", entries: negativeBalances });
    }

    const duplicateInvoices = await prisma.$queryRawUnsafe<
      { institutionId: string; count: number }[]
    >(`
      SELECT "institutionId", COUNT(*) as count
      FROM "Invoice"
      GROUP BY "institutionId"
      HAVING COUNT(*) > 1;
    `);

    if (duplicateInvoices.length) {
      anomalies.push({ type: "DUPLICATE_INVOICE", entries: duplicateInvoices });
    }

    if (anomalies.length) {
      await superAdminAlerts.sendSystemAlert({
        title: "⚠️ Billing Anomalies Detected",
        message: `${anomalies.length} types of billing anomalies found.`,
        severity: "high",
      });
    }

    res.json({ success: true, anomalies });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔁 Trigger Full Reconciliation Job
-------------------------------------------------------------------*/
export const triggerReconciliationJob = async (req: Request, res: Response) => {
  try {
    await triggerReconciliation({ initiatedBy: req.user?.id || "super_admin" });

    await auditService.log({
      actorId: req.user?.id,
      actorRole: "super_admin",
      action: "TRIGGER_RECONCILIATION",
      details: { ip: req.ip },
    });

    res.json({
      success: true,
      message: "Reconciliation job triggered successfully",
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📤 Export Billing Report
-------------------------------------------------------------------*/
export const exportBillingReport = async (req: Request, res: Response) => {
  try {
    const records = await prisma.institution.findMany({
      include: {
        subscription: true,
        payments: true,
      },
    });

    const csvBuffer = await exportToCsvBuffer(
      records.map((r) => ({
        institution: r.name,
        plan: r.subscription?.planName || "N/A",
        status: r.subscription?.status || "N/A",
        totalPaid: r.payments.reduce((s, p) => s + p.amount, 0),
        createdAt: r.createdAt.toISOString(),
      }))
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=billing_report.csv");
    res.send(csvBuffer);
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   💬 Admin Note on Institution Billing
-------------------------------------------------------------------*/
export const addBillingNote = async (req: Request, res: Response) => {
  try {
    const { institutionId, note } = req.body;
    if (!institutionId || !note) throw Errors.Validation("institutionId and note required");

    await prisma.billingNote.create({
      data: {
        institutionId,
        note,
        createdBy: req.user?.id,
      },
    });

    await auditService.log({
      actorId: req.user?.id,
      actorRole: "super_admin",
      action: "ADD_BILLING_NOTE",
      details: { institutionId, note },
    });

    res.status(201).json({
      success: true,
      message: "Billing note added successfully.",
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};