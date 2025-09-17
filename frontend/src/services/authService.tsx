import api from "./api";

const AuthService = {
  login: async (credentials: any) => {
    try {
      const response = await api.post("/api/login", credentials);
      // In a real application, you would store a JWT token here
      // localStorage.setItem('token', response.data.token);
      return response.data;
    } catch (error: any) {
      throw error.response.data;
    }
  },

  register: async (userData: any) => {
    try {
      const response = await api.post("/api/register", userData);
      return response.data;
    } catch (error: any) {
      throw error.response.data;
    }
  },

  logout: () => {
    // In a real application, you would remove the token
    // localStorage.removeItem('token');
  },

  isAuthenticated: () => {
    // In a real application, you would check if a valid token exists
    // return !!localStorage.getItem('token');
    return true; // For now, we return true to bypass the ProtectedRoute
  }
};

export default AuthService;
