import api from "./api";

interface Athlete {
  id: number;
  name: string;
}

export const athletesService = {
  getAthletes: async (): Promise<Athlete[]> => {
    const response = await api.get('/api/athletes');
    return response.data;
  },

  // New function to create a new athlete
  createAthlete: async (name: string): Promise<Athlete> => {
    const response = await api.post('/api/athletes', { name });
    return response.data;
  }
};
