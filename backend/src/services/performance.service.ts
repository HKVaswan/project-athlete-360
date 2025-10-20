// src/services/performance.service.ts
import prisma from "../prismaClient";
import logger from "../logger";

export const getPerformanceData = async (athleteId: string) => {
  return await prisma.performance.findMany({
    where: { athleteId },
    orderBy: { date: "asc" },
  });
};

export const getPerformanceSummary = async (athleteId: string) => {
  try {
    const records = await prisma.performance.findMany({ where: { athleteId } });
    if (!records.length) return { averageScore: 0, bestScore: 0, trend: "stable" };

    const scores = records.map(r => r.metric_value);
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const bestScore = Math.max(...scores);

    const trend =
      scores.length >= 3
        ? scores[scores.length - 1] > scores[scores.length - 3]
          ? "improving"
          : "declining"
        : "stable";

    return { averageScore, bestScore, trend };
  } catch (err) {
    logger.error("Error computing performance summary: " + err);
    throw new Error("Performance summary calculation failed");
  }
};
