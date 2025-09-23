// src/services/trainingSessionsService.ts
import api from "./api";

export interface TrainingSession {
  id: string;
  athlete_id: string;
  session_date: string;
  notes: string;
}

export interface CreateTrainingSessionInput {
  athlete_id: string;
  notes: string;
  session_date?: string; // optional, defaults to current date
}

export const trainingSessionsService = {
  // Create a new training session
  createTrainingSession: async (input: CreateTrainingSessionInput): Promise<TrainingSession> => {
    try {
      const response = await api.post("/api/training-sessions", {
        athlete_id: input.athlete_id,
        notes: input.notes,
        session_date: input.session_date || new Date().toISOString(),
      });
      return response.data;
    } catch (error) {
      console.error("Failed to create training session:", error);
      throw new Error("Unable to create training session.");
    }
  },

  // Get all training sessions for a specific athlete
  getTrainingSessions: async (athleteId: string): Promise<TrainingSession[]> => {
    try {
      const response = await api.get(`/api/training-sessions/${athleteId}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch training sessions:", error);
      throw new Error("Unable to fetch training sessions.");
    }
  },
};