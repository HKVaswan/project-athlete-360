/**
 * src/lib/featureFlags.ts
 * -------------------------------------------------------------
 * Enterprise Feature Flag Manager
 *
 * - Allows controlled rollout of experimental or AI features
 * - Supports environment-based overrides (prod, staging, dev)
 * - Provides caching and persistent storage for global toggles
 * - Integrates with DB or Redis for distributed consistency
 */

import { config } from "../config";
import { logger } from "../logger";
import { redisClient } from "../lib/cache";

type FeatureFlagKey =
  | "ai_integration"
  | "ai_coach_beta"
  | "new_dashboard"
  | "performance_forecast"
  | "dark_mode"
  | "maintenance_mode";

interface FeatureFlag {
  key: FeatureFlagKey;
  enabled: boolean;
  description?: string;
  lastUpdated: Date;
}

const LOCAL_FLAGS: Record<FeatureFlagKey, FeatureFlag> = {
  ai_integration: {
    key: "ai_integration",
    enabled: config.env !== "production", // enable AI in dev/test only
    description: "Enable AI features and background workers",
    lastUpdated: new Date(),
  },
  ai_coach_beta: {
    key: "ai_coach_beta",
    enabled: false,
    description: "AI Coach assistant (beta release)",
    lastUpdated: new Date(),
  },
  new_dashboard: {
    key: "new_dashboard",
    enabled: true,
    description: "Next-gen athlete dashboard (UI refresh)",
    lastUpdated: new Date(),
  },
  performance_forecast: {
    key: "performance_forecast",
    enabled: false,
    description: "Predictive performance analytics (experimental)",
    lastUpdated: new Date(),
  },
  dark_mode: {
    key: "dark_mode",
    enabled: true,
    description: "Dark mode for athlete and admin portals",
    lastUpdated: new Date(),
  },
  maintenance_mode: {
    key: "maintenance_mode",
    enabled: false,
    description: "Temporarily disable system access for updates",
    lastUpdated: new Date(),
  },
};

/**
 * Load a feature flag from Redis (if exists), else fallback to local cache
 */
export const getFeatureFlag = async (key: FeatureFlagKey): Promise<FeatureFlag> => {
  try {
    const redisFlag = await redisClient.get(`feature:${key}`);
    if (redisFlag) {
      return JSON.parse(redisFlag);
    }
  } catch (err: any) {
    logger.warn(`[FEATURE FLAGS] Redis fetch failed for ${key}: ${err.message}`);
  }
  return LOCAL_FLAGS[key];
};

/**
 * Set or update a feature flag (persists in Redis)
 */
export const setFeatureFlag = async (
  key: FeatureFlagKey,
  enabled: boolean,
  description?: string
): Promise<void> => {
  const flag: FeatureFlag = {
    key,
    enabled,
    description: description || LOCAL_FLAGS[key]?.description,
    lastUpdated: new Date(),
  };

  LOCAL_FLAGS[key] = flag;

  try {
    await redisClient.set(`feature:${key}`, JSON.stringify(flag));
    logger.info(`[FEATURE FLAGS] Updated flag: ${key} → ${enabled}`);
  } catch (err: any) {
    logger.error(`[FEATURE FLAGS] Failed to persist flag ${key}: ${err.message}`);
  }
};

/**
 * Check if a feature is enabled
 */
export const isFeatureEnabled = async (key: FeatureFlagKey): Promise<boolean> => {
  const flag = await getFeatureFlag(key);
  return flag?.enabled ?? false;
};

/**
 * Load all active flags (for admin dashboards)
 */
export const listAllFlags = async (): Promise<FeatureFlag[]> => {
  return Object.values(LOCAL_FLAGS);
};