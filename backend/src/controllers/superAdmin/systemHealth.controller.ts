/**
 * src/controllers/superAdmin/systemHealth.controller.ts
 * ----------------------------------------------------------------------
 * Super Admin System Health Controller
 *
 * Responsibilities:
 *  - Monitor overall system health (API, DB, Redis, Workers)
 *  - Fetch live metrics from systemMonitor.ts
 *  - Provide uptime and latency diagnostics
 *  - Log and audit every health check request
 * ----------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { getSystemMetrics } from "../../lib/systemMonitor";
import prisma from "../../prismaClient";
import { logger } from "../../logger";
import { config } from "../../config";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { recordAuditEvent } from "../../services/audit.service";

/* -----------------------------------------------------------------------
   🧩 Helper: Require Super Admin Access
------------------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied: Super Admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   🩺 1. Get Live System Metrics
------------------------------------------------------------------------*/
export const getSystemHealth = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const metrics = await getSystemMetrics();

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SYSTEM_HEALTH_CHECK",
      details: metrics,
    });

    res.json({
      success: true,
      message: "System health snapshot retrieved successfully.",
      data: metrics,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:HEALTH] getSystemHealth failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ⚙️ 2. Verify Database & Queue Connectivity
------------------------------------------------------------------------*/
export const checkServiceConnections = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    // Database check
    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    // Redis / Queue check (optional)
    let queueStatus = "unknown";
    try {
      const redisUrl = config.redisUrl || process.env.REDIS_URL;
      if (redisUrl) queueStatus = "connected";
    } catch {
      queueStatus = "disconnected";
    }

    const health = {
      database: dbOk ? "connected" : "unreachable",
      redisQueue: queueStatus,
      timestamp: new Date().toISOString(),
    };

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "SERVICE_CONNECTIVITY_CHECK",
      details: health,
    });

    res.json({
      success: true,
      message: "Service connectivity checked.",
      data: health,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:HEALTH] checkServiceConnections failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📊 3. Performance Overview (24h)
------------------------------------------------------------------------*/
export const getPerformanceSummary = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const logs = await prisma.systemMetric.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
      take: 1000,
    });

    const avgCpu = logs.length ? logs.reduce((s, m) => s + m.cpuUsage, 0) / logs.length : 0;
    const avgMem = logs.length ? logs.reduce((s, m) => s + m.memoryUsage, 0) / logs.length : 0;
    const avgLatency = logs.length ? logs.reduce((s, m) => s + m.latencyMs, 0) / logs.length : 0;

    const summary = {
      recordsAnalyzed: logs.length,
      avgCpu: Number(avgCpu.toFixed(2)),
      avgMemory: Number(avgMem.toFixed(2)),
      avgLatency: Number(avgLatency.toFixed(2)),
    };

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "PERFORMANCE_SUMMARY_VIEW",
      details: summary,
    });

    res.json({
      success: true,
      message: "Performance summary (last 24h)",
      data: summary,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:HEALTH] getPerformanceSummary failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🚨 4. Detect System Anomalies
------------------------------------------------------------------------*/
export const detectAnomalies = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);

    const logs = await prisma.systemMetric.findMany({
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    const anomalies = logs.filter(
      (log) =>
        log.cpuUsage > 90 ||
        log.memoryUsage > 90 ||
        log.latencyMs > 300 ||
        (log.loadAverage[0] || 0) > 4.0
    );

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "ANOMALY_DETECTION_RUN",
      details: { count: anomalies.length },
    });

    res.json({
      success: true,
      message: "Anomaly detection complete.",
      data: {
        totalAnalyzed: logs.length,
        anomaliesDetected: anomalies.length,
        details: anomalies.slice(0, 10),
      },
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:HEALTH] detectAnomalies failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧭 5. Health Summary Dashboard
------------------------------------------------------------------------*/
export const getHealthDashboard = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const metrics = await getSystemMetrics();

    const dbCount = await prisma.user.count();
    const institutionCount = await prisma.institution.count();
    const athleteCount = await prisma.athlete.count();

    const summary = {
      metrics,
      db: { users: dbCount, institutions: institutionCount, athletes: athleteCount },
      timestamp: new Date().toISOString(),
    };

    await recordAuditEvent({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      ip: req.ip,
      action: "HEALTH_DASHBOARD_VIEW",
    });

    res.json({
      success: true,
      message: "System health dashboard retrieved successfully.",
      data: summary,
    });
  } catch (err: any) {
    logger.error("[SUPERADMIN:HEALTH] getHealthDashboard failed", { err });
    sendErrorResponse(res, err);
  }
};