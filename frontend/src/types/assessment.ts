// src/types/assessment.ts

export interface Assessment {
  id: string;
  athlete_id: string;
  session_id: string;
  metric: string;
  value: string;
  notes?: string;
  institution_id: string;
}

export interface CreateAssessmentInput {
  athlete_id: string;
  session_id: string;
  metric: string;
  value: string;
  notes?: string;
}

export interface UpdateAssessmentInput extends CreateAssessmentInput {
  id: string;
}
