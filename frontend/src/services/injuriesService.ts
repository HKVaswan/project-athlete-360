// src/services/injuriesService.ts

import api from "./api";
import { Injury, InjuryPayload } from "../types/injury";

const BASE = "/injuries";

export const injuriesService = {
  async getAll(): Promise<Injury[]> {
    const { data } = await api.get(BASE);
    return data;
  },

  async getByAthlete(athleteId: string): Promise<Injury[]> {
    const { data } = await api.get(`${BASE}?athleteId=${athleteId}`);
    return data;
  },

  async create(payload: InjuryPayload): Promise<Injury> {
    const { data } = await api.post(BASE, payload);
    return data;
  },

  async update(id: string, payload: InjuryPayload): Promise<Injury> {
    const { data } = await api.put(`${BASE}/${id}`, payload);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`${BASE}/${id}`);
  },
};
