// src/services/sessionsService.ts
import api from "./api";
import { Session, SessionPayload } from "../types/session";

export const sessionsService = {
  getSessions: async (): Promise<Session[]> => {
    const { data } = await api.get("/sessions");
    return data;
  },

  createSession: async (payload: SessionPayload): Promise<Session> => {
    const { data } = await api.post("/sessions", payload);
    return data;
  },

  updateSession: async (id: string, payload: SessionPayload): Promise<Session> => {
    const { data } = await api.put(`/sessions/${id}`, payload);
    return data;
  },

  deleteSession: async (id: string): Promise<void> => {
    await api.delete(`/sessions/${id}`);
  },
};
