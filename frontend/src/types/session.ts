// src/types/session.ts

export interface Session {
  id: string;
  name: string;
  date: string;
  location: string;
  institutionId: string;
}

export interface SessionPayload {
  name: string;
  date: string;
  location: string;
}
