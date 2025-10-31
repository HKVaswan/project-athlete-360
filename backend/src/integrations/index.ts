/**
 * Integrations index / orchestrator
 *
 * Responsibilities:
 *  - Central place to register, initialize and health-check third-party integrations.
 *  - Lazy-loads optional integrations so missing files don't crash bootstrap in early stages.
 *  - Provides typed accessors (e.g. getAIClient) so the rest of the app doesn't need to know import paths.
 *  - Robust error handling and structured logging for enterprise-grade reliability.
 *
 * Usage:
 *  await Integrations.initAll();
 *  const ai = await Integrations.getAIClient();
 *  const status = await Integrations.healthAll();
 */

import type { Logger } from "winston";
import path from "path";
import { config } from "../config";
import logger from "../logger";

export type IntegrationHealth = {
  ok: boolean;
  name: string;
  message?: string;
  details?: any;
  checkedAt: string;
};

export interface Integration {
  name: string;
  init?: () => Promise<void>;
  healthCheck?: () => Promise<IntegrationHealth>;
  shutdown?: () => Promise<void>;
}

/**
 * Internal registry of integrations
 */
const registry: Map<string, Integration> = new Map();

/**
 * Safe register method — allows re-registration (returns previous if present)
 */
export const registerIntegration = (integration: Integration) => {
  const prev = registry.get(integration.name);
  registry.set(integration.name, integration);
  logger.info(`[INTEGRATIONS] Registered integration: ${integration.name}`);
  return prev ?? null;
};

/**
 * Safe dynamic loader helper — attempts to import a module and returns default export if present.
 * This prevents bootstrap failure if optional integrations aren't implemented yet.
 */
const tryImport = async <T = any>(relPath: string): Promise<T | null> => {
  try {
    const abs = path.join(__dirname, relPath);
    // dynamic import so we don't break at compile-time if file missing
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import(abs);
    return mod?.default ?? mod;
  } catch (err: any) {
    logger.debug(`[INTEGRATIONS] Optional integration not loaded (${relPath}): ${err?.message ?? err}`);
    return null;
  }
};

/**
 * Initialize selected integrations (lazy)
 * - The list below is intentionally simple — we only load integrations that are available.
 * - Integrations should register themselves when imported OR be manually registered above.
 */
export const initAll = async () => {
  logger.info("[INTEGRATIONS] Initializing integrations...");

  // CORE: always register a no-op health-checker for core system
  registerIntegration({
    name: "core",
    healthCheck: async () => ({
      ok: true,
      name: "core",
      message: "core OK",
      checkedAt: new Date().toISOString(),
    }),
  });

  // Attempt to import and register optional integrations (if files exist)
  //  - aiIntegration (lib/aiClient or integrations/aiIntegration)
  const ai = await tryImport("./aiIntegration");
  if (ai && ai.default) registerIntegration(ai.default);
  else if (ai) registerIntegration(ai as Integration);

  const email = await tryImport("./emailIntegration");
  if (email && email.default) registerIntegration(email.default);
  else if (email) registerIntegration(email as Integration);

  const storage = await tryImport("./storageIntegration");
  if (storage && storage.default) registerIntegration(storage.default);
  else if (storage) registerIntegration(storage as Integration);

  const notification = await tryImport("./notificationIntegration");
  if (notification && notification.default) registerIntegration(notification.default);
  else if (notification) registerIntegration(notification as Integration);

  const monitoring = await tryImport("./monitoring.integration");
  if (monitoring && monitoring.default) registerIntegration(monitoring.default);
  else if (monitoring) registerIntegration(monitoring as Integration);

  const dataSync = await tryImport("./dataSync.integration");
  if (dataSync && dataSync.default) registerIntegration(dataSync.default);
  else if (dataSync) registerIntegration(dataSync as Integration);

  // call init on each integration that provides one (in parallel, but handle failures per integration)
  await Promise.all(
    Array.from(registry.values()).map(async (intg) => {
      if (intg.init) {
        try {
          await intg.init();
          logger.info(`[INTEGRATIONS] Initialized: ${intg.name}`);
        } catch (err: any) {
          logger.error(`[INTEGRATIONS] Failed to initialize ${intg.name}: ${err?.message ?? err}`);
        }
      }
    })
  );

  logger.info("[INTEGRATIONS] Initialization complete.");
};

/**
 * Run health checks for all registered integrations.
 * Returns an array of IntegrationHealth objects. This should be used for readiness/liveness endpoints.
 */
export const healthAll = async (): Promise<IntegrationHealth[]> => {
  const results: IntegrationHealth[] = [];

  await Promise.all(
    Array.from(registry.values()).map(async (intg) => {
      const base: IntegrationHealth = {
        ok: false,
        name: intg.name,
        message: "no health check",
        checkedAt: new Date().toISOString(),
      };

      if (!intg.healthCheck) {
        results.push({ ...base, ok: true, message: "no healthCheck provided (assumed OK)" });
        return;
      }

      try {
        const r = await intg.healthCheck();
        results.push(r);
      } catch (err: any) {
        logger.error(`[INTEGRATIONS] Health check failed for ${intg.name}: ${err?.message ?? err}`);
        results.push({
          ...base,
          ok: false,
          message: err?.message ?? "health check error",
          details: err?.stack ?? err,
        });
      }
    })
  );

  return results;
};

/**
 * Shutdown all integrations that expose shutdown()
 */
export const shutdownAll = async () => {
  logger.info("[INTEGRATIONS] Shutting down integrations...");
  await Promise.all(
    Array.from(registry.values()).map(async (intg) => {
      if (intg.shutdown) {
        try {
          await intg.shutdown();
          logger.info(`[INTEGRATIONS] Shutdown: ${intg.name}`);
        } catch (err: any) {
          logger.error(`[INTEGRATIONS] Shutdown failed for ${intg.name}: ${err?.message ?? err}`);
        }
      }
    })
  );
  logger.info("[INTEGRATIONS] All integrations shut down.");
};

/**
 * Convenience getter for integrations
 */
export const getIntegration = (name: string): Integration | null => {
  return registry.get(name) ?? null;
};

/**
 * Enterprise helper: Get the AI client (lazy)
 *
 * - This function attempts to return the registered 'ai' integration if available.
 * - If not registered, it tries to dynamically import a library-level ai client (lib/aiClient).
 * - If nothing found, throws a descriptive error so callers can handle fallback logic.
 */
let _aiClient: any | null = null;
export const getAIClient = async (): Promise<any> => {
  if (_aiClient) return _aiClient;

  // check registered integration
  const reg = getIntegration("ai") || getIntegration("aiIntegration") || getIntegration("ai-service");
  if (reg && (reg as any).client) {
    _aiClient = (reg as any).client;
    return _aiClient;
  }

  // try to import a library-level client
  const libClient = await tryImport("../lib/aiClient");
  if (libClient) {
    // libClient may export default or named client
    _aiClient = libClient.default ?? libClient.aiClient ?? libClient;
    logger.info("[INTEGRATIONS] aiClient loaded from lib/aiClient");
    return _aiClient;
  }

  // try integrations/aiIntegration.default.client if defined
  const aiIntegration = registry.get("aiIntegration") ?? registry.get("ai");
  if (aiIntegration && (aiIntegration as any).client) {
    _aiClient = (aiIntegration as any).client;
    return _aiClient;
  }

  const msg = "AI client not available. Ensure integrations/aiIntegration or lib/aiClient exists and is registered.";
  logger.warn(`[INTEGRATIONS] ${msg}`);
  throw new Error(msg);
};

/**
 * Health route helper — returns summarized object for easy HTTP responses.
 */
export const healthSummary = async () => {
  const checks = await healthAll();
  const overallOk = checks.every((c) => c.ok);
  return {
    ok: overallOk,
    timestamp: new Date().toISOString(),
    integrations: checks,
  };
};

/**
 * Default export: high-level integrations manager
 */
const Integrations = {
  registerIntegration,
  initAll,
  healthAll,
  shutdownAll,
  getIntegration,
  getAIClient,
  healthSummary,
};

export default Integrations;