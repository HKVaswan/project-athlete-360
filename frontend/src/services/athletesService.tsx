import api from "./api";

interface Athlete {
  id: number;
  name: string;
  athlete_id: string;
}

export const athletesService = {
  getAthletes: async (): Promise<Athlete[]> => {
    const response = await api.get('/api/athletes');
    return response.data;
  },

  createAthlete: async (name: string, athlete_id: string): Promise<Athlete> => {
    const response = await api.post('/api/athletes', { name, athlete_id });
    return response.data;
  },

  deleteAthlete: async (id: number): Promise<void> => {
    await api.delete(`/api/athletes/${id}`);
  },

  updateAthlete: async (id: number, name: string, athlete_id: string): Promise<Athlete> => {
    const response = await api.put(`/api/athletes/${id}`, { name, athlete_id });
    return response.data;
  }
};

