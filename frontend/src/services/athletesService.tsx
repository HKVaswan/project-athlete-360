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

  // Existing function to create a new athlete
  createAthlete: async (name: string): Promise<Athlete> => {
    const response = await api.post('/api/athletes', { name });
    return response.data;
  },

  // New function to delete an athlete by ID
  deleteAthlete: async (id: number): Promise<void> => {
    await api.delete(`/api/athletes/${id}`);
  }
};
