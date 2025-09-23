// src/types/assessment.ts

export interface Assessment {
  id: string;
  athlete_id: string;
  session_id: string;
  metric: string;
  value: string;
  notes?: string;
  institution_id: string;
  created_at?: string; // optional timestamp
  updated_at?: string; // optional timestamp
}

export interface CreateAssessmentInput {
  athlete_id: string;
  session_id: string;
  metric: string;
  value: string;
  notes?: string;
}

export interface UpdateAssessmentInput {
  id: string;
  athlete_id: string;
  session_id: string;
  metric: string;
  value: string;
  notes?: string;
}