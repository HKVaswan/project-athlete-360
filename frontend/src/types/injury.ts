// src/types/injury.ts

export interface Injury {
  id: string;
  athleteId: string;
  description: string;
  date: string; // ISO string
  severity: "minor" | "moderate" | "severe";
}

export interface InjuryPayload {
  athleteId: string;
  description: string;
  date: string;
  severity: "minor" | "moderate" | "severe";
}
