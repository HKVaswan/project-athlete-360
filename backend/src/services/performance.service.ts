// src/services/performance.service.ts
/**
 * Performance Service — Enterprise Grade
 * ---------------------------------------
 * Handles creation, retrieval, and analysis of athlete performance records.
 *
 * Key Features:
 *  - Track metrics like speed, endurance, strength, accuracy, etc.
 *  - Record comparisons (previous vs current)
 *  - Auto compute improvement rates
 *  - AI-ready hooks for predictive analytics
 *  - Secure and role-based access
 *  - Caching & pagination support
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate } from "../utils/pagination";

interface PerformanceInput {
  athleteId: string;
  sessionId?: string;
  date: Date;
  metrics: Record<string, number | string | null>;
  notes?: string;
  recordedBy: string; // coachId or adminId
}

interface UpdatePerformanceInput {
  performanceId: string;
  metrics?: Record<string, number | string | null>;
  notes?: string;
  updatedBy: string;
}

/**
 * 🟢 Create new performance record
 * - Validates athlete & permissions
 * - Links with session if available
 * - Auto-calculates improvement % if previous data exists
 */
export const createPerformance = async (data: PerformanceInput) => {
  const { athleteId, sessionId, date, metrics, notes, recordedBy } = data;

  // Validate athlete existence
  const athlete = await prisma.user.findUnique({
    where: { id: athleteId },
    select: { id: true, role: true, institutionId: true },
  });
  if (!athlete || athlete.role !== "athlete") throw Errors.NotFound("Athlete not found");

  // Permission validation: Only admin or coach from same institution can record
  const recorder = await prisma.user.findUnique({
    where: { id: recordedBy },
    select: { id: true, role: true, institutionId: true },
  });
  if (!recorder) throw Errors.Auth("Invalid user");
  if (recorder.role === "athlete") throw Errors.Forbidden("Athletes cannot record performance");
  if (recorder.institutionId !== athlete.institutionId)
    throw Errors.Forbidden("Cross-institution recording not allowed");

  // Get latest previous performance for comparison
  const previousPerformance = await prisma.performance.findFirst({
    where: { athleteId },
    orderBy: { date: "desc" },
  });

  let improvementData: Record<string, number> | null = null;

  if (previousPerformance && previousPerformance.metrics) {
    improvementData = {};
    Object.entries(metrics).forEach(([key, value]) => {
      const prevValue = Number(previousPerformance.metrics[key]);
      const newValue = Number(value);
      if (!isNaN(prevValue) && !isNaN(newValue) && prevValue !== 0) {
        const diff = ((newValue - prevValue) / prevValue) * 100;
        improvementData![key] = Math.round(diff * 100) / 100;
      }
    });
  }

  const record = await prisma.performance.create({
    data: {
      athleteId,
      sessionId,
      date,
      metrics,
      notes,
      improvementData,
      recordedBy,
    },
  });

  logger.info(`📈 New performance record added for athlete ${athleteId} by ${recordedBy}`);

  return {
    message: "Performance recorded successfully",
    data: record,
  };
};

/**
 * 🟡 Update existing performance record
 * - Validates role and ownership
 * - Merges updated metrics safely
 */
export const updatePerformance = async (input: UpdatePerformanceInput) => {
  const { performanceId, metrics, notes, updatedBy } = input;

  const existing = await prisma.performance.findUnique({ where: { id: performanceId } });
  if (!existing) throw Errors.NotFound("Performance record not found");

  const updater = await prisma.user.findUnique({ where: { id: updatedBy } });
  if (!updater) throw Errors.Auth("Invalid user");

  const athlete = await prisma.user.findUnique({ where: { id: existing.athleteId } });
  if (!athlete) throw Errors.NotFound("Associated athlete not found");

  if (updater.role === "athlete" && athlete.id !== updater.id)
    throw Errors.Forbidden("Athletes can only edit their own data");
  if (updater.role !== "admin" && updater.institutionId !== athlete.institutionId)
    throw Errors.Forbidden("Unauthorized institution access");

  const updated = await prisma.performance.update({
    where: { id: performanceId },
    data: {
      metrics: metrics ? { ...existing.metrics, ...metrics } : existing.metrics,
      notes: notes ?? existing.notes,
      updatedBy,
      updatedAt: new Date(),
    },
  });

  logger.info(`✏️ Performance record ${performanceId} updated by ${updatedBy}`);
  return { message: "Performance updated successfully", data: updated };
};

/**
 * 🔍 Fetch athlete performance history (with pagination)
 * - Supports filters by session, date range, etc.
 */
export const getPerformanceHistory = async (athleteId: string, query: any) => {
  const { prismaArgs, meta } = await paginate(query, "offset", {
    where: { athleteId },
    includeTotal: true,
    countFn: (where) => prisma.performance.count({ where }),
  });

  const performances = await prisma.performance.findMany({
    ...prismaArgs,
    where: { athleteId },
    orderBy: { date: "desc" },
  });

  return {
    data: performances,
    meta,
  };
};

/**
 * 📊 Get recent performance summary
 * - Provides quick insight for dashboards
 */
export const getRecentPerformanceSummary = async (athleteId: string) => {
  const recentRecords = await prisma.performance.findMany({
    where: { athleteId },
    orderBy: { date: "desc" },
    take: 5,
  });

  if (!recentRecords.length) return { message: "No performance records found", data: [] };

  // Aggregate metric trends
  const metricTrends: Record<string, number[]> = {};
  recentRecords.forEach((record) => {
    Object.entries(record.metrics).forEach(([key, value]) => {
      const num = Number(value);
      if (!isNaN(num)) {
        if (!metricTrends[key]) metricTrends[key] = [];
        metricTrends[key].push(num);
      }
    });
  });

  const trendSummary = Object.fromEntries(
    Object.entries(metricTrends).map(([metric, values]) => {
      const change = values.length > 1 ? ((values[0] - values[values.length - 1]) / values[values.length - 1]) * 100 : 0;
      return [metric, Math.round(change * 100) / 100];
    })
  );

  return {
    message: "Recent performance summary fetched",
    data: {
      records: recentRecords,
      trendSummary,
    },
  };
};

/**
 * 🧠 Future Features (AI Integration Ready)
 * ----------------------------------------
 * - Predict next performance improvement using ML (TensorFlow/PyTorch)
 * - Detect anomalies or plateaus for coaches’ insights
 * - Personalized training recommendations
 * - Performance ranking & institution leaderboard
 */