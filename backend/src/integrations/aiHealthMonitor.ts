import { AiProviderManager } from "./aiProviderManager";
import logger from "../logger";
import os from "os";

interface ProviderHealth {
  providerId: string;
  healthy: boolean;
  latencyMs?: number;
  failureRate?: number;
  circuitOpen?: boolean;
  lastChecked: string;
}

interface AIHealthSummary {
  timestamp: string;
  totalProviders: number;
  healthyProviders: number;
  degradedProviders: number;
  providerStats: ProviderHealth[];
  system: {
    cpuLoad: number;
    memoryUsageMB: number;
    uptimeMinutes: number;
  };
}

/**
 * AI Health Monitor
 * ---------------------------------------------------------
 * Continuously monitors AI provider performance, latency, and
 * health signals — logs anomalies and can trigger alerts.
 */
export class AiHealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private providerFailureMap: Map<string, number[]> = new Map(); // sliding window of failures

  constructor(
    private providerManager: AiProviderManager,
    private intervalMs: number = 60_000 // default: every 1 minute
  ) {}

  /**
   * Start health monitoring loop
   */
  start() {
    if (this.intervalId) return;
    logger.info(`[AI Health] 🩺 Starting AI health monitor (${this.intervalMs / 1000}s interval)`);
    this.intervalId = setInterval(() => this.runCheck(), this.intervalMs);
  }

  /**
   * Stop monitoring loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("[AI Health] 🧹 Stopped AI health monitor");
    }
  }

  /**
   * Perform health check across all AI providers
   */
  private async runCheck() {
    try {
      const results = await this.providerManager.healthCheck();
      const summary = this.aggregate(results);
      this.logSummary(summary);
      this.detectAnomalies(summary);
    } catch (err: any) {
      logger.error(`[AI Health] ❌ Failed to check AI health: ${err.message}`);
    }
  }

  /**
   * Aggregate raw health data into summary
   */
  private aggregate(results: Record<string, any>): AIHealthSummary {
    const providerStats: ProviderHealth[] = [];
    let healthyCount = 0;
    let degradedCount = 0;

    for (const [id, r] of Object.entries(results)) {
      const isHealthy = r.healthy === true && !r.circuit?.openUntil;
      const failureRate = this.calculateFailureRate(id, !isHealthy);

      if (isHealthy) healthyCount++;
      else degradedCount++;

      providerStats.push({
        providerId: id,
        healthy: isHealthy,
        failureRate,
        circuitOpen: !!r.circuit?.openUntil,
        lastChecked: new Date().toISOString(),
      });
    }

    const sys = process.memoryUsage();
    return {
      timestamp: new Date().toISOString(),
      totalProviders: providerStats.length,
      healthyProviders: healthyCount,
      degradedProviders: degradedCount,
      providerStats,
      system: {
        cpuLoad: os.loadavg()[0],
        memoryUsageMB: Math.round(sys.rss / 1024 / 1024),
        uptimeMinutes: Math.floor(process.uptime() / 60),
      },
    };
  }

  /**
   * Log health summary
   */
  private logSummary(summary: AIHealthSummary) {
    const { healthyProviders, totalProviders, degradedProviders } = summary;
    logger.info(
      `[AI Health] ✅ ${healthyProviders}/${totalProviders} providers healthy, ${degradedProviders} degraded`
    );
  }

  /**
   * Detect anomalies (provider degradation, rising failures)
   */
  private detectAnomalies(summary: AIHealthSummary) {
    for (const p of summary.providerStats) {
      if (!p.healthy || (p.failureRate ?? 0) > 0.3) {
        logger.warn(
          `[AI Health] ⚠️ Provider '${p.providerId}' unstable (failureRate=${p.failureRate?.toFixed(
            2
          )}, circuitOpen=${p.circuitOpen})`
        );
        // Here we can integrate: alertManager.notify('ai_health', p)
      }
    }

    if (summary.degradedProviders > 0) {
      logger.warn(`[AI Health] 🚨 ${summary.degradedProviders} degraded AI providers detected.`);
    }
  }

  /**
   * Compute failure rate from sliding window
   */
  private calculateFailureRate(providerId: string, failed: boolean): number {
    const now = Date.now();
    const window = this.providerFailureMap.get(providerId) || [];

    const recent = window.filter((t) => now - t < 10 * 60 * 1000); // last 10 minutes
    if (failed) recent.push(now);

    this.providerFailureMap.set(providerId, recent);

    return Math.min(1, recent.length / 10); // crude 10-check failure ratio
  }
}

/**
 * Factory for easy creation and startup
 */
export const startAiHealthMonitor = (providerManager: AiProviderManager) => {
  const monitor = new AiHealthMonitor(providerManager, 60_000);
  monitor.start();
  return monitor;
};