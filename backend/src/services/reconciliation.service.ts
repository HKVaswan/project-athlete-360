/**
 * src/services/reconciliation.service.ts
 * ---------------------------------------------------------------------------
 * 🔍 Enterprise Reconciliation Service
 *
 * Ensures financial consistency between local DB and payment providers.
 * Detects & auto-corrects mismatched or missing transactions.
 * ---------------------------------------------------------------------------
 */

import { prisma } from "../prismaClient";
import { logger } from "../logger";
import { stripeAdapter } from "./billingAdapters/stripe.adapter";
import { razorpayAdapter } from "./billingAdapters/razorpay.adapter";
import { createSuperAdminAlert } from "./superAdminAlerts.service";
import { auditService } from "./audit.service";

interface ReconciliationSummary {
  provider: "stripe" | "razorpay";
  checked: number;
  mismatched: number;
  corrected: number;
  unresolved: number;
  details: Array<{
    transactionId: string;
    reason: string;
    actionTaken: string;
  }>;
}

export class ReconciliationService {
  private static batchSize = 200;

  /**
   * 🚀 Run full reconciliation process for all payment providers
   */
  static async runFullReconciliation(): Promise<ReconciliationSummary[]> {
    logger.info("[RECONCILE] 🔍 Starting enterprise reconciliation...");

    const results: ReconciliationSummary[] = [];

    try {
      results.push(await this.reconcileStripe());
    } catch (err: any) {
      logger.error("[RECONCILE] ❌ Stripe reconciliation failed", { err });
      await createSuperAdminAlert({
        title: "Stripe Reconciliation Error",
        message: err.message,
        severity: "high",
      });
    }

    try {
      results.push(await this.reconcileRazorpay());
    } catch (err: any) {
      logger.error("[RECONCILE] ❌ Razorpay reconciliation failed", { err });
      await createSuperAdminAlert({
        title: "Razorpay Reconciliation Error",
        message: err.message,
        severity: "high",
      });
    }

    await prisma.reconciliationReport.create({
      data: {
        executedAt: new Date(),
        summary: results,
        mismatchedCount: results.reduce((acc, r) => acc + r.mismatched, 0),
        correctedCount: results.reduce((acc, r) => acc + r.corrected, 0),
      },
    });

    await createSuperAdminAlert({
      title: "Reconciliation Completed",
      message: `Results: ${results.map(r => `${r.provider}: ${r.mismatched} mismatched`).join(", ")}`,
      category: "billing",
      severity: results.some(r => r.mismatched > 0) ? "medium" : "low",
    });

    return results;
  }

  /* ---------------------------------------------------------------------- */
  /* 🧾 STRIPE */
  /* ---------------------------------------------------------------------- */
  private static async reconcileStripe(): Promise<ReconciliationSummary> {
    logger.info("[RECONCILE] 🔎 Reconciling Stripe...");

    const total = await prisma.billingTransaction.count({ where: { provider: "stripe" } });
    let offset = 0;
    let mismatched = 0;
    let corrected = 0;
    const details: ReconciliationSummary["details"] = [];

    while (offset < total) {
      const localPayments = await prisma.billingTransaction.findMany({
        where: { provider: "stripe" },
        skip: offset,
        take: this.batchSize,
      });

      for (const tx of localPayments) {
        try {
          const remote = await stripeAdapter.fetchPayment(tx.transactionId);
          if (!remote) continue;

          const localStatus = tx.status;
          const remoteStatus = remote.status;
          const localAmount = tx.amountPaid;
          const remoteAmount = remote.amount / 100;

          if (localStatus !== remoteStatus || localAmount !== remoteAmount) {
            mismatched++;
            const actionTaken = await this.resolveDiscrepancy("stripe", tx.id, {
              localStatus,
              remoteStatus,
              localAmount,
              remoteAmount,
            });
            if (actionTaken === "corrected") corrected++;

            details.push({
              transactionId: tx.transactionId,
              reason: `Local(${localStatus}/${localAmount}) vs Remote(${remoteStatus}/${remoteAmount})`,
              actionTaken,
            });
          }
        } catch (err: any) {
          logger.warn(`[RECONCILE] ⚠️ Stripe transaction skipped ${tx.transactionId}`, { err });
        }
      }
      offset += this.batchSize;
    }

    return {
      provider: "stripe",
      checked: total,
      mismatched,
      corrected,
      unresolved: mismatched - corrected,
      details,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* 💰 RAZORPAY */
  /* ---------------------------------------------------------------------- */
  private static async reconcileRazorpay(): Promise<ReconciliationSummary> {
    logger.info("[RECONCILE] 💰 Reconciling Razorpay...");

    const total = await prisma.billingTransaction.count({ where: { provider: "razorpay" } });
    let offset = 0;
    let mismatched = 0;
    let corrected = 0;
    const details: ReconciliationSummary["details"] = [];

    while (offset < total) {
      const localPayments = await prisma.billingTransaction.findMany({
        where: { provider: "razorpay" },
        skip: offset,
        take: this.batchSize,
      });

      for (const tx of localPayments) {
        try {
          const remote = await razorpayAdapter.fetchPayment(tx.transactionId);
          if (!remote) continue;

          const localStatus = tx.status;
          const remoteStatus = remote.status;
          const localAmount = tx.amountPaid;
          const remoteAmount = remote.amount / 100;

          if (localStatus !== remoteStatus || localAmount !== remoteAmount) {
            mismatched++;
            const actionTaken = await this.resolveDiscrepancy("razorpay", tx.id, {
              localStatus,
              remoteStatus,
              localAmount,
              remoteAmount,
            });
            if (actionTaken === "corrected") corrected++;

            details.push({
              transactionId: tx.transactionId,
              reason: `Local(${localStatus}/${localAmount}) vs Remote(${remoteStatus}/${remoteAmount})`,
              actionTaken,
            });
          }
        } catch (err: any) {
          logger.warn(`[RECONCILE] ⚠️ Razorpay transaction skipped ${tx.transactionId}`, { err });
        }
      }
      offset += this.batchSize;
    }

    return {
      provider: "razorpay",
      checked: total,
      mismatched,
      corrected,
      unresolved: mismatched - corrected,
      details,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* 🛠️ Resolve Mismatch */
  /* ---------------------------------------------------------------------- */
  private static async resolveDiscrepancy(
    provider: "stripe" | "razorpay",
    transactionId: string,
    info: any
  ): Promise<"corrected" | "flagged"> {
    try {
      return await prisma.$transaction(async tx => {
        if (info.remoteStatus === "succeeded" && info.localStatus !== "succeeded") {
          await tx.billingTransaction.update({
            where: { id: transactionId },
            data: {
              status: "succeeded",
              amountPaid: info.remoteAmount,
              reconciledAt: new Date(),
            },
          });

          await auditService.record({
            actorId: "system",
            actorRole: "system",
            action: "AUTO_CORRECT_PAYMENT",
            details: { provider, transactionId, info },
          });

          logger.info(`[RECONCILE] ✅ Auto-corrected ${provider} transaction ${transactionId}`);
          return "corrected";
        }

        await tx.billingTransaction.update({
          where: { id: transactionId },
          data: { flagged: true },
        });

        await auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "FLAG_PAYMENT_DISCREPANCY",
          details: { provider, transactionId, info },
        });

        logger.warn(`[RECONCILE] ⚠️ Flagged ${provider} transaction ${transactionId}`);
        return "flagged";
      });
    } catch (err: any) {
      logger.error(`[RECONCILE] ❌ Failed to resolve discrepancy for ${transactionId}`, { err });
      return "flagged";
    }
  }
}

export const reconciliationService = ReconciliationService;