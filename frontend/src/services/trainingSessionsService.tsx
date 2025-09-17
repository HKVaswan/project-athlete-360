import api from "./api";

export const trainingSessionsService = {
  createTrainingSession: async (athleteId: string, notes: string) => {
    const response = await api.post("/api/training-sessions", { athlete_id: athleteId, notes });
    return response.data;
  }
};
