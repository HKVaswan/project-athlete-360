// src/types/plans.d.ts
/**
 * types/plans.d.ts
 * ---------------------------------------------------------------------
 * Central type definitions for subscription plans and usage limits.
 *
 * Features:
 *  - Free, paid, and enterprise plan distinctions
 *  - AI-ready: easily extendable for machine learning & analytics features
 *  - Explicit limits for users, coaches, and data storage
 *  - Enforces institution-wide usage policies
 * ---------------------------------------------------------------------
 */

export type PlanTier = "FREE" | "STARTER" | "PRO" | "ELITE" | "ENTERPRISE";

export type PlanFeature = {
  key: string; // e.g., 'athlete_limit', 'storage_gb', 'analytics_access'
  label: string; // readable label for UI
  description?: string;
  limit?: number | null; // null means unlimited
  unit?: string; // e.g. 'athletes', 'GB', 'videos'
  enabled?: boolean;
};

/**
 * 🧾 Plan definition as stored in database or config
 */
export interface Plan {
  id: string;
  name: string;
  tier: PlanTier;
  monthlyPrice: number; // in cents
  yearlyPrice: number; // in cents
  currency: string; // ISO 4217 (e.g., INR, USD)
  description: string;
  features: PlanFeature[];
  isPublic: boolean;
  active: boolean;
  trialDays?: number; // optional for free trials
  storageLimitGB: number;
  athleteLimit: number;
  coachLimit: number;
  videoUploadLimit: number;
  maxAdmins?: number;
  maxTeams?: number;
  supportLevel: "basic" | "priority" | "dedicated";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 🧠 Plan Usage Snapshot
 * ------------------------------------------------------------------
 * For tracking per-institution consumption.
 */
export interface PlanUsage {
  institutionId: string;
  planId: string;
  usedAthletes: number;
  usedStorageGB: number;
  usedVideos: number;
  lastUpdated: Date;
}

/**
 * 💳 Subscription Metadata
 * ------------------------------------------------------------------
 * Mirrors live subscription state from payment providers
 * like Stripe or Razorpay.
 */
export interface SubscriptionMetadata {
  id: string;
  institutionId: string;
  planId: string;
  provider: "stripe" | "razorpay" | "manual";
  status: "active" | "past_due" | "cancelled" | "expired" | "trialing";
  trialEndsAt?: Date;
  currentPeriodEnd: Date;
  autoRenew: boolean;
  paymentMethodId?: string;
  nextBillingAmountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ⚙️ Plan Enforcement Rules
 * ------------------------------------------------------------------
 * Used by quotaService & middleware to restrict resource creation.
 */
export interface PlanRule {
  resource: "athlete" | "coach" | "storage" | "video";
  limit: number;
  errorMessage: string;
}

/**
 * 🔔 Usage Thresholds (for alerts and emails)
 * ------------------------------------------------------------------
 */
export interface UsageThreshold {
  percentage: number; // e.g. 70, 85, 95
  message: string; // used in notification/email templates
  critical?: boolean; // marks 95% or similar thresholds
}

/**
 * 🧾 Plan Comparison (UI + API)
 * ------------------------------------------------------------------
 * For showing upgrade/downgrade choices.
 */
export interface PlanComparison {
  currentPlan: Plan;
  nextPlan: Plan;
  upgradeRecommended: boolean;
  missingFeatures?: string[];
  savingsPercent?: number;
}