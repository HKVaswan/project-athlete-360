import api from "./api";

interface TrainingSession {
  session_date: string;
  notes: string;
}

export const trainingSessionsService = {
  createTrainingSession: async (athleteId: string, notes: string) => {
    const response = await api.post("/api/training-sessions", { athlete_id: athleteId, notes });
    return response.data;
  },

  getTrainingSessions: async (athleteId: string): Promise<TrainingSession[]> => {
    const response = await api.get(`/api/training-sessions/${athleteId}`);
    return response.data;
  }
};
