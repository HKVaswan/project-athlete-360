// src/types/attendance.ts

export interface AttendanceRecord {
  id: string;
  session_id: string;
  athlete_id: string;
  present: boolean;
  created_at?: string; // optional timestamp
  updated_at?: string; // optional timestamp
}

export interface AttendancePayload {
  session_id: string;
  athlete_id: string;
  present: boolean;
}