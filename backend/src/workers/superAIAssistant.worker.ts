/**
 * src/workers/superAIAssistant.worker.ts
 * --------------------------------------------------------------------------
 * Super AI Assistant Worker 🤖
 *
 * Responsibilities:
 *  - Periodically analyze audit logs, analytics, and performance data
 *  - Generate intelligent summaries and recommendations for Super Admins
 *  - Detect weak patterns, recurring incidents, or optimization opportunities
 *  - Auto-create "AI Insights" notifications or reports
 *
 * Features:
 *  - Uses ProjectAthlete360’s unified AI client (aiClient)
 *  - Fully audited and restricted to system/super_admin users
 *  - Can run scheduled (daily) or on-demand (manual trigger)
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import { prisma } from "../prismaClient";
import { logger } from "../logger";
import aiClient from "../lib/ai/aiClient";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";

interface SuperAIJobPayload {
  mode: "daily_summary" | "incident_analysis" | "system_optimization";
  initiatedBy?: string;
}

/**
 * 🧠 Super AI Assistant Worker
 */
export default async function (job: Job<SuperAIJobPayload>) {
  const { mode, initiatedBy = "system" } = job.data;
  logger.info(`[SUPER-AI] 🧠 Starting AI analysis mode: ${mode}`);

  try {
    switch (mode) {
      case "daily_summary":
        await generateDailySummary(initiatedBy);
        break;

      case "incident_analysis":
        await analyzeRecentIncidents(initiatedBy);
        break;

      case "system_optimization":
        await generateOptimizationSuggestions(initiatedBy);
        break;

      default:
        logger.warn(`[SUPER-AI] Unknown analysis mode: ${mode}`);
        break;
    }

    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "AI_DECISION",
      details: { event: "super_ai_analysis_completed", mode },
    });

    logger.info(`[SUPER-AI] ✅ ${mode} analysis completed successfully.`);
  } catch (err: any) {
    logger.error(`[SUPER-AI] ❌ ${mode} analysis failed: ${err.message}`);
    await auditService.log({
      actorId: initiatedBy,
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      details: { event: "super_ai_analysis_failed", mode, error: err.message },
    });
  }
}

/* -----------------------------------------------------------------------
   📊 Daily Summary Report Generation
------------------------------------------------------------------------*/
async function generateDailySummary(initiatedBy: string) {
  const [auditCount, anomalies, alerts] = await Promise.all([
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [{ action: "SECURITY_EVENT" }, { action: "ADMIN_OVERRIDE" }],
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({
      where: { type: { in: ["analyticsAlert", "systemAlert"] } },
    }),
  ]);

  const prompt = `
You are the Super Admin AI Analyst for ProjectAthlete360.
Analyze the following system data and generate a concise report (150 words max):

- Total audits in last 24h: ${auditCount}
- Critical anomalies: ${anomalies.length}
- Active alerts: ${alerts}

Recent anomalies:
${JSON.stringify(anomalies, null, 2)}

Provide actionable recommendations and one confidence score (0–100).
`;

  const aiSummary = await aiClient.generate(prompt);

  await adminNotificationService.broadcastAlert({
    title: "🧠 Daily AI Summary Report",
    body: aiSummary.slice(0, 500),
  });

  logger.info(`[SUPER-AI] 📄 Daily summary generated.`);
}

/* -----------------------------------------------------------------------
   🚨 Incident Pattern Analysis
------------------------------------------------------------------------*/
async function analyzeRecentIncidents(initiatedBy: string) {
  const incidents = await prisma.auditLog.findMany({
    where: {
      action: { in: ["SECURITY_EVENT", "SYSTEM_ALERT", "ADMIN_OVERRIDE"] },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (incidents.length === 0) {
    logger.info(`[SUPER-AI] No recent incidents to analyze.`);
    return;
  }

  const prompt = `
Analyze the following system incidents for patterns, risks, and root causes.
Provide a risk rating (Low/Medium/High) and summary of key vulnerabilities.

Data:
${JSON.stringify(incidents, null, 2)}
`;

  const analysis = await aiClient.generate(prompt);

  await adminNotificationService.broadcastAlert({
    title: "🚨 AI Incident Pattern Analysis",
    body: analysis.slice(0, 800),
  });

  logger.info(`[SUPER-AI] 🚨 Incident analysis completed.`);
}

/* -----------------------------------------------------------------------
   ⚙️ System Optimization Insights
------------------------------------------------------------------------*/
async function generateOptimizationSuggestions(initiatedBy: string) {
  const [metrics, jobCounts, pendingBackups] = await Promise.all([
    prisma.systemMetric.findMany({ take: 10, orderBy: { createdAt: "desc" } }),
    prisma.jobQueue.count({ where: { status: "pending" } }),
    prisma.systemBackup.count({ where: { status: "pending" } }),
  ]);

  const prompt = `
Analyze the system performance data and provide specific, practical suggestions
to optimize server efficiency, resource usage, and worker throughput.

System Metrics:
${JSON.stringify(metrics, null, 2)}
Pending Jobs: ${jobCounts}
Pending Backups: ${pendingBackups}
`;

  const aiAdvice = await aiClient.generate(prompt);

  await adminNotificationService.broadcastAlert({
    title: "⚙️ AI Optimization Suggestions",
    body: aiAdvice.slice(0, 700),
  });

  logger.info(`[SUPER-AI] ⚙️ Optimization insights generated.`);
}
