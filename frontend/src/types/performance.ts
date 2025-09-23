// src/types/performance.ts

export interface PerformanceData {
  id: string;
  athlete_id: string;
  assessment_type: string;
  score: number;
  date: string; // ISO string
  created_at?: string;
  updated_at?: string;
}

export interface PerformanceSummary {
  average_score: number;
  best_score: number;
  trend: "improving" | "declining" | "stable";
}