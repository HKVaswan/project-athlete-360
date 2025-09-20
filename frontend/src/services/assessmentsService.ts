// src/services/assessmentsService.ts
import api from "./api";
import { Assessment, CreateAssessmentInput, UpdateAssessmentInput } from "../types/assessment";

export const assessmentsService = {
  async getAll(): Promise<Assessment[]> {
    const response = await api.get("/assessments");
    return response.data;
  },

  async create(data: CreateAssessmentInput): Promise<Assessment> {
    const response = await api.post("/assessments", data);
    return response.data;
  },

  async update(id: string, data: UpdateAssessmentInput): Promise<Assessment> {
    const response = await api.put(`/assessments/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/assessments/${id}`);
  },
};
 
