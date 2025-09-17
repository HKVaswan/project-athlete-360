import api from "./api";

export const authService = {
  login: async (username, password) => {
    const response = await api.post("/api/login", { username, password });
    return response.data;
  },
};
