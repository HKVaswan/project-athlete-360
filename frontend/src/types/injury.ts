// src/types/injury.ts

export interface Injury {
  id: string;
  athlete_id: string;
  description: string;
  date: string; // ISO string
  severity: "minor" | "moderate" | "severe";
  created_at?: string;
  updated_at?: string;
}

export interface InjuryPayload {
  athlete_id: string;
  description: string;
  date: string;
  severity: "minor" | "moderate" | "severe";
}