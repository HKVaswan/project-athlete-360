// src/services/athletesService.ts
import api from "./api";

export interface Athlete {
  id: number;
  name: string;
  athlete_id: string;
}

export const athletesService = {
  getAll: async (): Promise<Athlete[]> => {
    try {
      const response = await api.get("/api/athletes");
      return response.data;
    } catch (err) {
      console.error("Failed to fetch athletes:", err);
      throw err;
    }
  },

  create: async (name: string, athlete_id: string): Promise<Athlete> => {
    try {
      const response = await api.post("/api/athletes", { name, athlete_id });
      return response.data;
    } catch (err) {
      console.error("Failed to create athlete:", err);
      throw err;
    }
  },

  update: async (id: number, name: string, athlete_id: string): Promise<Athlete> => {
    try {
      const response = await api.put(`/api/athletes/${id}`, { name, athlete_id });
      return response.data;
    } catch (err) {
      console.error(`Failed to update athlete ${id}:`, err);
      throw err;
    }
  },

  remove: async (id: number): Promise<void> => {
    try {
      await api.delete(`/api/athletes/${id}`);
    } catch (err) {
      console.error(`Failed to delete athlete ${id}:`, err);
      throw err;
    }
  },
};