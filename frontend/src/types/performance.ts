// src/types/performance.ts

export interface PerformanceData {
  id: string;
  athleteId: string;
  assessmentType: string;
  score: number;
  date: string;
}

export interface PerformanceSummary {
  averageScore: number;
  bestScore: number;
  trend: "improving" | "declining" | "stable";
}
 
