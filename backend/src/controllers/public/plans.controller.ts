/**
 * src/controllers/public/plans.controller.ts
 * ---------------------------------------------------------------------
 * 📦 Public Plans Controller
 *
 * Responsible for:
 *  - Serving sanitized plan metadata for pricing & signup pages
 *  - Enforcing single-trial eligibility checks
 *  - Providing transparent billing, quota, and overage info
 *  - Integrating with internal config (planConfig.ts)
 *
 * Audience: Public users (unauthenticated) & onboarding clients
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { planConfig } from "../../config/planConfig";
import { trialAuditService } from "../../services/trialAudit.service";
import { prisma } from "../../prismaClient";
import { cache } from "../../lib/cache";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import crypto from "crypto";

/* ---------------------------------------------------------------------
   🧠 1. Utility – Mask sensitive plan fields for public APIs
------------------------------------------------------------------------*/
const sanitizePlan = (plan: any) => {
  const { internalNotes, costPrice, isDeprecated, ...rest } = plan;
  return rest;
};

/* ---------------------------------------------------------------------
   ⚡ 2. GET /api/public/plans
   → Returns all active public plans (cached)
------------------------------------------------------------------------*/
export const getPublicPlans = async (_req: Request, res: Response) => {
  try {
    const cacheKey = "public:plans:v1";
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    const plans = Object.values(planConfig.plans)
      .filter((p) => !p.hidden && !p.deprecated)
      .map(sanitizePlan);

    // Cache for 30 min
    await cache.set(cacheKey, plans, 60 * 30);

    res.json({ success: true, data: plans });
  } catch (err: any) {
    logger.error("[PUBLIC:PLANS] Failed to list plans", { err });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------
   ⚙️ 3. GET /api/public/plans/:idOrSlug
   → Returns details of a single plan
------------------------------------------------------------------------*/
export const getPlanByIdOrSlug = async (req: Request, res: Response) => {
  try {
    const { idOrSlug } = req.params;
    const plan =
      Object.values(planConfig.plans).find(
        (p) => p.id === idOrSlug || p.slug === idOrSlug
      ) ?? null;

    if (!plan) throw Errors.NotFound("Plan not found.");

    res.json({ success: true, data: sanitizePlan(plan) });
  } catch (err: any) {
    logger.error("[PUBLIC:PLANS] getPlanByIdOrSlug failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------
   🧩 4. POST /api/public/trial/check
   → Verify trial eligibility before signup
------------------------------------------------------------------------*/
export const checkTrialEligibility = async (req: Request, res: Response) => {
  try {
    const { email, ip, userAgent, deviceId, institutionId } = req.body || {};
    if (!email || !ip) throw Errors.Validation("Missing required parameters.");

    const fingerprint = { email, ip, userAgent, deviceId, institutionId };
    const hashedKey = crypto
      .createHash("sha256")
      .update(`${ip}-${email}`)
      .digest("hex");

    const cachedEligibility = await cache.get(`trial:check:${hashedKey}`);
    if (cachedEligibility !== null) {
      return res.json({
        success: true,
        data: { eligible: cachedEligibility },
        cached: true,
      });
    }

    try {
      await trialAuditService.detectTrialAbuse(fingerprint);
      await cache.set(`trial:check:${hashedKey}`, true, 60 * 30);
      return res.json({ success: true, data: { eligible: true } });
    } catch {
      await cache.set(`trial:check:${hashedKey}`, false, 60 * 30);
      return res.json({ success: true, data: { eligible: false } });
    }
  } catch (err: any) {
    logger.error("[PUBLIC:PLANS] checkTrialEligibility failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------
   🧾 5. GET /api/public/plans/compare
   → Compare all plans (for pricing tables)
------------------------------------------------------------------------*/
export const comparePlans = async (_req: Request, res: Response) => {
  try {
    const plans = Object.values(planConfig.plans)
      .filter((p) => !p.hidden && !p.deprecated)
      .map((p) => ({
        name: p.name,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        features: p.features,
        limits: p.limits,
        overage: p.overage,
      }));

    res.json({ success: true, data: plans });
  } catch (err: any) {
    logger.error("[PUBLIC:PLANS] comparePlans failed", { err });
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------------
   🚀 6. Optional – GET /api/public/plans/summary
   → Provides metadata for caching and frontend build
------------------------------------------------------------------------*/
export const getPlansSummary = async (_req: Request, res: Response) => {
  try {
    const totalPlans = Object.keys(planConfig.plans).length;
    const publicPlans = Object.values(planConfig.plans).filter(
      (p) => !p.hidden && !p.deprecated
    ).length;

    res.json({
      success: true,
      data: {
        totalPlans,
        publicPlans,
        version: planConfig.version,
        updatedAt: planConfig.lastUpdated,
      },
    });
  } catch (err: any) {
    logger.error("[PUBLIC:PLANS] getPlansSummary failed", { err });
    sendErrorResponse(res, err);
  }
};