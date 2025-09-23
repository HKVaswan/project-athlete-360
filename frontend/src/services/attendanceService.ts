// src/services/attendanceService.ts
import api from "./api";
import { AttendanceRecord, AttendancePayload } from "../types/attendance";

export const attendanceService = {
  getBySession: async (sessionId: string): Promise<AttendanceRecord[]> => {
    try {
      const { data } = await api.get(`/attendance`, { params: { sessionId } });
      return data;
    } catch (err) {
      console.error(`Failed to fetch attendance for session ${sessionId}:`, err);
      throw err;
    }
  },

  create: async (payload: AttendancePayload): Promise<AttendanceRecord> => {
    try {
      const { data } = await api.post("/attendance", payload);
      return data;
    } catch (err) {
      console.error("Failed to mark attendance:", err);
      throw err;
    }
  },

  update: async (id: string, payload: Partial<AttendancePayload>): Promise<AttendanceRecord> => {
    try {
      const { data } = await api.put(`/attendance/${id}`, payload);
      return data;
    } catch (err) {
      console.error(`Failed to update attendance ${id}:`, err);
      throw err;
    }
  },
};