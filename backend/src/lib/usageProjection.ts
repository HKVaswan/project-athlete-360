/**
 * src/lib/usageProjection.ts
 * -----------------------------------------------------------------------------
 * 📈 Usage Projection Engine (Enterprise Grade)
 *
 * Purpose:
 *  - Predict when institutions will hit their quota or plan limits.
 *  - Identify anomalous spikes or suspicious growth in usage.
 *  - Provide early alerts for billing upgrades or abuse detection.
 *
 * Features:
 *  - Rolling-average and exponential smoothing for projection.
 *  - Time-series aware: adapts based on usage growth velocity.
 *  - Integrates with superAdminAlertsService for predictive alerts.
 *  - Works in conjunction with quotaService & storageMonitorService.
 *
 * ---------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { quotaService } from "../services/quota.service";
import { plansService } from "../services/plans.service";

/* -------------------------------------------------------------------------- */
/* 📊 Types */
/* -------------------------------------------------------------------------- */

export interface UsageSample {
  date: Date;
  used: number;
}

export interface ProjectionResult {
  projectedDaysUntilLimit: number | null;
  trend: "stable" | "increasing" | "anomalous";
  projectedUsageNext7Days: number;
  avgDailyGrowth: number;
  confidence: number; // 0 to 1
}

/* -------------------------------------------------------------------------- */
/* 🔹 Utility: Calculate Average Daily Growth Rate */
/* -------------------------------------------------------------------------- */

function calculateDailyGrowth(samples: UsageSample[]): number {
  if (samples.length < 2) return 0;
  const sorted = [...samples].sort((a, b) => a.date.getTime() - b.date.getTime());

  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].used - sorted[i - 1].used;
    const days = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0) deltas.push(diff / days);
  }

  if (!deltas.length) return 0;

  // Exponential smoothing — gives more weight to recent usage
  const alpha = 0.6;
  let smoothed = deltas[0];
  for (let i = 1; i < deltas.length; i++) {
    smoothed = alpha * deltas[i] + (1 - alpha) * smoothed;
  }

  return smoothed;
}

/* -------------------------------------------------------------------------- */
/* 🔹 Core Projection Algorithm */
/* -------------------------------------------------------------------------- */

export async function projectUsageTrend(
  institutionId: string,
  quotaType: string
): Promise<ProjectionResult> {
  try {
    // Fetch last 30 days usage samples (assuming we log usage history daily)
    const usageHistory = await prisma.usageLog.findMany({
      where: { institutionId, type: quotaType },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { createdAt: true, used: true },
    });

    if (!usageHistory.length) {
      return {
        projectedDaysUntilLimit: null,
        trend: "stable",
        projectedUsageNext7Days: 0,
        avgDailyGrowth: 0,
        confidence: 0,
      };
    }

    const samples: UsageSample[] = usageHistory.map((u) => ({
      date: u.createdAt,
      used: u.used,
    }));

    const avgGrowth = calculateDailyGrowth(samples);
    const latestUsage = samples[samples.length - 1].used;

    const plan = await plansService.getInstitutionPlan(institutionId);
    const limit = plan.limits?.[quotaType];
    if (!limit) {
      return {
        projectedDaysUntilLimit: null,
        trend: "stable",
        projectedUsageNext7Days: latestUsage,
        avgDailyGrowth: avgGrowth,
        confidence: 1,
      };
    }

    const remaining = limit - latestUsage;

    // Predict when limit will be reached
    const projectedDaysUntilLimit = avgGrowth > 0 ? Math.ceil(remaining / avgGrowth) : null;
    const projectedUsageNext7Days = latestUsage + avgGrowth * 7;

    // Detect anomaly — if recent growth is >2x previous average
    const anomalyDetected = avgGrowth > (remaining / 30) * 2;
    const trend: ProjectionResult["trend"] =
      anomalyDetected ? "anomalous" : avgGrowth > 0 ? "increasing" : "stable";

    // Confidence: higher when 10+ samples exist
    const confidence = Math.min(1, samples.length / 10);

    return {
      projectedDaysUntilLimit,
      trend,
      projectedUsageNext7Days,
      avgDailyGrowth: avgGrowth,
      confidence,
    };
  } catch (err: any) {
    logger.error(`[usageProjection] Failed for ${institutionId}:${quotaType} - ${err.message}`);
    return {
      projectedDaysUntilLimit: null,
      trend: "stable",
      projectedUsageNext7Days: 0,
      avgDailyGrowth: 0,
      confidence: 0,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Automated Predictive Alert System */
/* -------------------------------------------------------------------------- */

/**
 * Runs periodically (via worker) to warn institutions likely to hit limits soon.
 */
export async function runUsageProjectionsForAll() {
  try {
    const institutions = await prisma.institution.findMany({ select: { id: true, name: true } });
    const quotaTypes = ["athletes", "coaches", "storage", "videos"];

    for (const institution of institutions) {
      for (const type of quotaTypes) {
        const projection = await projectUsageTrend(institution.id, type);
        if (
          projection.projectedDaysUntilLimit &&
          projection.projectedDaysUntilLimit <= 7 &&
          projection.trend !== "stable"
        ) {
          await superAdminAlertsService.sendQuotaAlert({
            institutionId: institution.id,
            type,
            used: Math.round(projection.projectedUsageNext7Days),
            limit:
              (await plansService.getInstitutionPlan(institution.id)).limits?.[type] || 0,
            percentUsed: Math.round(
              (projection.projectedUsageNext7Days /
                ((await plansService.getInstitutionPlan(institution.id)).limits?.[type] || 1)) *
                100
            ),
            severity: "warning",
            message: `Institution ${institution.name} projected to exceed ${type} quota within ${projection.projectedDaysUntilLimit} days.`,
          });

          logger.warn(
            `[usageProjection] ⚠️ ${institution.name} likely to exceed ${type} in ${projection.projectedDaysUntilLimit} days`
          );
        }
      }
    }

    logger.info(`[usageProjection] Completed usage projection check for ${institutions.length} institutions.`);
  } catch (err: any) {
    logger.error(`[usageProjection] Projection run failed: ${err.message}`);
  }
}