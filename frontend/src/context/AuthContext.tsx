// src/context/AuthContext.tsx
import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";

const API_URL =
  import.meta.env.VITE_API_URL || "https://project-athlete-360.onrender.com";

interface UserInfo {
  id: number | string;
  username: string;
  email?: string;
  name?: string;
  role?: string;
}

interface AuthContextType {
  token: string | null;
  user: UserInfo | null;
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
  isAuthenticated: boolean;
  loginUser: (username: string, password: string) => Promise<boolean>;
  registerUser: (
    username: string,
    password: string,
    name: string,
    dob: string,
    sport: string,
    gender: string,
    contact_info: string
  ) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(
    localStorage.getItem("auth_token")
  );
  const [user, setUser] = useState<UserInfo | null>(() => {
    const stored = localStorage.getItem("auth_user");
    return stored ? JSON.parse(stored) : null;
  });

  const login = (newToken: string, userInfo: UserInfo) => {
    setToken(newToken);
    setUser(userInfo);
    localStorage.setItem("auth_token", newToken);
    localStorage.setItem("auth_user", JSON.stringify(userInfo));

    // Redirect based on role
    if (userInfo.role === "admin") navigate("/admin-dashboard");
    else if (userInfo.role === "coach") navigate("/coach-dashboard");
    else navigate("/athlete-dashboard");
  };

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    navigate("/login");
  }, [navigate]);

  const loginUser = async (username: string, password: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.access_token) {
        console.error("Login error:", data);
        return false;
      }

      const token = data.access_token;
      const userData = data.user || data.data;

      login(token, userData);
      return true;
    } catch (err) {
      console.error("❌ Login failed:", err);
      return false;
    }
  };

  const registerUser = async (
    username: string,
    password: string,
    name: string,
    dob: string,
    sport: string,
    gender: string,
    contact_info: string
  ) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          name,
          dob,
          sport,
          gender,
          contact_info,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        console.error("Registration error:", data);
        return false;
      }

      // Automatically log in user if backend sends token
      if (data.access_token) {
        login(data.access_token, data.user || data.data.user);
      }

      return true;
    } catch (err) {
      console.error("❌ Registration failed:", err);
      return false;
    }
  };

  const isAuthenticated = !!token && !!user;

  // Auto restore session from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    const storedUser = localStorage.getItem("auth_user");

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        login,
        logout,
        isAuthenticated,
        loginUser,
        registerUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};