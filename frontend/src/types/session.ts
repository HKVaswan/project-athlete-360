// src/types/session.ts

export interface Session {
  id: string;
  name: string;
  date: string; // ISO string
  location: string;
  institution_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SessionPayload {
  name: string;
  date: string; // ISO string
  location: string;
}