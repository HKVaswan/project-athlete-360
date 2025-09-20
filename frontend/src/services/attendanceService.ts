// src/services/attendanceService.ts
import api from "./api";
import { AttendanceRecord, AttendancePayload } from "../types/attendance";

export const attendanceService = {
  getAttendance: async (sessionId: string): Promise<AttendanceRecord[]> => {
    const { data } = await api.get(`/attendance?sessionId=${sessionId}`);
    return data;
  },

  markAttendance: async (payload: AttendancePayload): Promise<AttendanceRecord> => {
    const { data } = await api.post("/attendance", payload);
    return data;
  },

  updateAttendance: async (id: string, payload: Partial<AttendancePayload>): Promise<AttendanceRecord> => {
    const { data } = await api.put(`/attendance/${id}`, payload);
    return data;
  },
};
 
