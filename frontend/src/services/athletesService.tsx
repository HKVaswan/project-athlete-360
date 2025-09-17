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

  createAthlete: async (name: string): Promise<Athlete> => {
    const response = await api.post('/api/athletes', { name });
    return response.data;
  },

  deleteAthlete: async (id: number): Promise<void> => {
    await api.delete(`/api/athletes/${id}`);
  },

  // New function to update an athlete by ID
  updateAthlete: async (id: number, name: string): Promise<Athlete> => {
    const response = await api.put(`/api/athletes/${id}`, { name });
    return response.data;
  }
};
