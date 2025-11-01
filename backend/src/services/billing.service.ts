/**
 * src/services/billing.service.ts
 * ---------------------------------------------------------------------
 * Robust Billing & Subscription Management Service
 * ---------------------------------------------------------------------
 * Responsibilities:
 *  - Manage and monitor institutional billing cycles
 *  - Prevent repeated free-tier abuse
 *  - Trigger plan renewal reminders
 *  - Lock expired accounts gracefully
 *  - Enforce system limits (storage, athlete count, uploads, etc.)
 *  - Notify super admin when nearing capacity or expiry thresholds
 * ---------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { sendEmail } from "../utils/email";
import { recordAuditEvent } from "./audit.service";
import { notifySuperAdmin } from "./adminNotification.service";
import { addDays, isBefore, differenceInDays } from "date-fns";
import { quotaService } from "./quota.service";

const FREE_TRIAL_DAYS = 30;
const EXPIRY_GRACE_DAYS = 5;

/* -----------------------------------------------------------------------
   🧩 Apply Free Trial (one-time only)
------------------------------------------------------------------------*/
export const applyFreeTrial = async (institutionId: string) => {
  const existingTrial = await prisma.subscription.findFirst({
    where: { institutionId, isTrial: true },
  });
  if (existingTrial) {
    throw Errors.Forbidden("Free trial already used.");
  }

  const freePlan = await prisma.plan.findFirst({ where: { tier: "FREE" } });
  if (!freePlan) throw Errors.Server("Free plan not configured.");

  const start = new Date();
  const end = addDays(start, FREE_TRIAL_DAYS);

  await prisma.subscription.create({
    data: {
      institutionId,
      planId: freePlan.id,
      status: "active",
      isTrial: true,
      startedAt: start,
      endsAt: end,
      provider: "internal",
    },
  });

  logger.info(`[BILLING] Free trial activated for institution ${institutionId}`);

  await sendEmail(
    institutionId,
    "🎉 Free Trial Activated!",
    `Your free trial for ${freePlan.name} plan is active until ${end.toDateString()}.`
  );
};

/* -----------------------------------------------------------------------
   📊 Check Subscription Status
------------------------------------------------------------------------*/
export const checkSubscriptionStatus = async (institutionId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { institutionId, status: "active" },
    include: { plan: true },
  });

  if (!subscription) throw Errors.Forbidden("No active subscription found.");

  const now = new Date();
  if (isBefore(subscription.endsAt, now)) {
    await lockExpiredAccount(institutionId);
    throw Errors.Forbidden("Subscription expired. Please renew your plan.");
  }

  return subscription;
};

/* -----------------------------------------------------------------------
   🚫 Enforce Plan Limits
------------------------------------------------------------------------*/
export const enforcePlanLimits = async (institutionId: string) => {
  const subscription = await checkSubscriptionStatus(institutionId);
  const plan = subscription.plan;

  // Enforce athlete linking limit
  const coachCount = await prisma.coachInstitution.count({ where: { institutionId } });
  const athleteCount = await prisma.athlete.count({ where: { institutionId } });

  if (athleteCount > plan.maxAthletes) {
    throw Errors.Forbidden("Athlete limit exceeded. Upgrade your plan to add more athletes.");
  }

  if (coachCount > plan.maxCoaches) {
    throw Errors.Forbidden("Coach limit exceeded for this plan.");
  }

  // Check storage quota
  const usage = await quotaService.calculateInstitutionUsage(institutionId);
  if (usage.storageUsedMB > plan.maxStorageMB) {
    throw Errors.Forbidden("Storage limit exceeded. Please upgrade your plan.");
  }

  // Optional: check video uploads, API requests, etc.
};

/* -----------------------------------------------------------------------
   🔁 Handle Plan Renewal
------------------------------------------------------------------------*/
export const handlePlanRenewal = async (institutionId: string) => {
  const sub = await prisma.subscription.findFirst({
    where: { institutionId, status: "active" },
  });

  if (!sub) throw Errors.NotFound("Subscription not found.");

  const now = new Date();
  if (isBefore(sub.endsAt, now)) {
    await lockExpiredAccount(institutionId);
    return { renewed: false, message: "Plan expired and account locked." };
  }

  // Extend for next billing period
  const renewed = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      startedAt: now,
      endsAt: addDays(now, 30),
      status: "active",
    },
  });

  await recordAuditEvent({
    actorId: institutionId,
    actorRole: "institution_admin",
    action: "PLAN_RENEWED",
    details: { subscriptionId: renewed.id },
  });

  logger.info(`[BILLING] Subscription renewed for institution ${institutionId}`);
  return { renewed: true };
};

/* -----------------------------------------------------------------------
   ⚠️ Send Renewal Reminder Emails
------------------------------------------------------------------------*/
export const sendRenewalReminders = async () => {
  const upcomingSubs = await prisma.subscription.findMany({
    where: {
      status: "active",
      endsAt: { lte: addDays(new Date(), 5) },
    },
    include: { institution: { select: { id: true, name: true, email: true } } },
  });

  for (const sub of upcomingSubs) {
    const daysLeft = differenceInDays(sub.endsAt, new Date());
    await sendEmail(
      sub.institution.email,
      "⚠️ Subscription Expiring Soon",
      `Your plan will expire in ${daysLeft} days. Please renew to continue uninterrupted access.`
    );

    await recordAuditEvent({
      actorId: sub.institution.id,
      actorRole: "institution_admin",
      action: "BILLING_REMINDER_SENT",
      details: { daysLeft },
    });

    logger.info(`[BILLING] Reminder sent to ${sub.institution.name}`);
  }
};

/* -----------------------------------------------------------------------
   🔒 Lock Expired Accounts
------------------------------------------------------------------------*/
export const lockExpiredAccount = async (institutionId: string) => {
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw Errors.NotFound("Institution not found");

  await prisma.subscription.updateMany({
    where: { institutionId },
    data: { status: "expired" },
  });

  await prisma.institution.update({
    where: { id: institutionId },
    data: { isLocked: true },
  });

  await sendEmail(
    institution.email,
    "🚫 Account Locked: Subscription Expired",
    "Your institution account has been locked due to expired subscription. Please renew your plan."
  );

  await recordAuditEvent({
    actorId: institutionId,
    actorRole: "institution_admin",
    action: "ACCOUNT_LOCKED",
    details: { reason: "Subscription expired" },
  });

  logger.warn(`[BILLING] Institution ${institutionId} locked due to expiry`);
};

/* -----------------------------------------------------------------------
   🧾 Generate Billing Summary
------------------------------------------------------------------------*/
export const generateBillingSummary = async (institutionId: string) => {
  const [sub, payments] = await Promise.all([
    prisma.subscription.findFirst({
      where: { institutionId },
      include: { plan: true },
    }),
    prisma.paymentSession.findMany({
      where: { userId: institutionId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    activePlan: sub?.plan.name || "None",
    status: sub?.status || "inactive",
    endsAt: sub?.endsAt,
    payments,
  };
};

/* -----------------------------------------------------------------------
   🚨 Notify Super Admin on Resource Threshold
------------------------------------------------------------------------*/
export const notifySuperAdminOnThreshold = async () => {
  const allInstitutions = await prisma.institution.findMany();
  for (const inst of allInstitutions) {
    const usage = await quotaService.calculateInstitutionUsage(inst.id);

    if (usage.storageUsedMB / usage.planStorageMB > 0.9) {
      await notifySuperAdmin({
        title: "⚠️ Storage Limit Nearing",
        body: `Institution ${inst.name} is at ${usage.storageUsedMB}MB / ${usage.planStorageMB}MB.`,
      });

      logger.warn(`[BILLING] ${inst.name} nearing storage threshold`);
    }
  }
};