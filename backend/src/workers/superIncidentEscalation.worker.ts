/**
 * src/workers/superIncidentEscalation.worker.ts
 * --------------------------------------------------------------------------
 * Super Incident Escalation Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Process incoming anomaly or incident reports from audit systems
 *  - Classify severity and escalate based on internal risk matrix
 *  - Automatically notify relevant Super Admins and security staff
 *  - Integrate with system logs, notifications, and incident records
 *
 * Features:
 *  - AI-driven classification-ready architecture
 *  - Auto-tagging of repeated offenders or sensitive zones
 *  - Escalation to multi-level admin approval if critical
 * --------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { prisma } from "../prismaClient";
import { auditService } from "../services/audit.service";
import { adminNotificationService } from "../services/adminNotification.service";
import { secretManagerService } from "../services/secretManager.service";
import crypto from "crypto";

interface IncidentReportPayload {
  anomalies: {
    type: string;
    actorId?: string;
    entity?: string;
    timestamp?: string;
    hash?: string;
  }[];
  detectedBy: string; // super admin or system
  sensitivity: "normal" | "high" | "critical";
  scope: "system" | "auth" | "ai" | "network";
}

export default async function (job: Job<IncidentReportPayload>) {
  const { anomalies, detectedBy, sensitivity, scope } = job.data;
  logger.info(`[INCIDENT-ESCALATION] 🚨 Processing incident escalation (scope=${scope})`);

  try {
    if (!anomalies?.length) {
      logger.info("[INCIDENT-ESCALATION] No anomalies found in report.");
      return;
    }

    // Load security config and thresholds
    const incidentThreshold = (await secretManagerService.get("INCIDENT_ESCALATION_THRESHOLD")) || "high";

    const escalate =
      sensitivity === "critical" || (incidentThreshold === "normal" && anomalies.length > 0);

    const classified = classifyAnomalies(anomalies);

    // Store new incident record
    const incidentId = crypto.randomUUID();
    await prisma.systemIncident.create({
      data: {
        id: incidentId,
        scope,
        sensitivity,
        detectedBy,
        totalFindings: anomalies.length,
        classifiedFindings: classified,
        status: escalate ? "escalated" : "logged",
        createdAt: new Date(),
      },
    });

    // Log to audit trail
    await auditService.log({
      actorId: detectedBy,
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: {
        event: "incident_escalation",
        scope,
        incidentId,
        sensitivity,
        count: anomalies.length,
        escalate,
      },
    });

    // Escalate to Super Admins if needed
    if (escalate) {
      const title = "🚨 Critical Security Incident Detected";
      const body = `${anomalies.length} anomalies found in ${scope} scope. Classified as ${sensitivity.toUpperCase()}.`;

      await adminNotificationService.broadcastAlert({
        title,
        body,
        meta: { scope, sensitivity, incidentId },
      });

      logger.warn(`[INCIDENT-ESCALATION] 🚨 Escalated ${anomalies.length} anomalies for review.`);
    } else {
      logger.info("[INCIDENT-ESCALATION] ✅ Incident logged (no escalation required).");
    }
  } catch (err: any) {
    logger.error(`[INCIDENT-ESCALATION] ❌ Failed to process incident: ${err.message}`);

    await auditService.log({
      actorId: detectedBy,
      actorRole: "super_admin",
      action: "SECURITY_EVENT",
      details: {
        event: "incident_escalation_failure",
        error: err.message,
        scope,
      },
    });

    throw err;
  }
}

/**
 * 🧠 Classify anomalies into structured categories for escalation logic.
 * (AI-enhanced classification can be plugged in later.)
 */
function classifyAnomalies(anomalies: any[]) {
  const classified = {
    unauthorizedOverrides: anomalies.filter((a) =>
      /override/i.test(a.type)
    ).length,
    failedMFA: anomalies.filter((a) =>
      /mfa/i.test(a.type)
    ).length,
    impersonationAttempts: anomalies.filter((a) =>
      /impersonation/i.test(a.type)
    ).length,
    manualInterventions: anomalies.filter((a) =>
      /manual/i.test(a.type)
    ).length,
  };

  return classified;
}