// src/services/assessmentsService.ts
import api from "./api";
import { Assessment, CreateAssessmentInput, UpdateAssessmentInput } from "../types/assessment";

export const assessmentsService = {
  async getAll(): Promise<Assessment[]> {
    try {
      const response = await api.get("/assessments");
      return response.data;
    } catch (err) {
      console.error("Failed to fetch assessments:", err);
      throw err;
    }
  },

  async create(data: CreateAssessmentInput): Promise<Assessment> {
    try {
      const response = await api.post("/assessments", data);
      return response.data;
    } catch (err) {
      console.error("Failed to create assessment:", err);
      throw err;
    }
  },

  async update(id: string, data: UpdateAssessmentInput): Promise<Assessment> {
    try {
      const response = await api.put(`/assessments/${id}`, data);
      return response.data;
    } catch (err) {
      console.error(`Failed to update assessment ${id}:`, err);
      throw err;
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await api.delete(`/assessments/${id}`);
    } catch (err) {
      console.error(`Failed to delete assessment ${id}:`, err);
      throw err;
    }
  },
};