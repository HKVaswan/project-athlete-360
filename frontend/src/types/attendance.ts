// src/types/attendance.ts

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  athleteId: string;
  present: boolean;
}

export interface AttendancePayload {
  sessionId: string;
  athleteId: string;
  present: boolean;
}
 
