import api from "./api";

export const athletesService = {
  getAthletes: async () => {
    const response = await api.get('/api/athletes');
    return response.data;
  }
};
