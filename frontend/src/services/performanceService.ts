// src/services/performanceService.ts

import api from "./api";
import { PerformanceData, PerformanceSummary } from "../types/performance";

export const performanceService = {
  async getAthletePerformance(athleteId: string): Promise<PerformanceData[]> {
    const res = await api.get(`/athletes/${athleteId}/assessments`);
    return res.data;
  },

  async getPerformanceSummary(athleteId: string): Promise<PerformanceSummary> {
    const res = await api.get(`/athletes/${athleteId}/performance-summary`);
    return res.data;
  },
};
 
