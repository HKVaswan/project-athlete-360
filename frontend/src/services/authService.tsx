// src/services/authService.ts
import api from "./api";

interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export const authService = {
  login: async (username: string, password: string): Promise<LoginResponse> => {
    try {
      const response = await api.post<LoginResponse>("/api/login", { username, password });
      return response.data;
    } catch (err: any) {
      console.error("Login failed:", err);
      throw new Error(err.response?.data?.message || "Network error. Please try again.");
    }
  },
};