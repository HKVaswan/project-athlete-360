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

const API_URL = (import.meta.env.VITE_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

interface UserInfo {
  id: string; // IMPORTANT: backend uses UUID strings
  username: string;
  role: string;
  exp?: number;
}

interface AuthContextType {
  token: string | null;
  user: UserInfo | null;
  authError: string | null;
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
  isAuthenticated: boolean;
  checkingAuth: boolean;
  checkAuth: () => Promise<boolean>;
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
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token") || sessionStorage.getItem("token"));
  const [user, setUser] = useState<UserInfo | null>(() => {
    const stored = localStorage.getItem("user") || sessionStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);

  const navigate = useNavigate();

  const clearStorage = useCallback(() => {
    try {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch (e) {
      // ignore
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStorage();
    setAuthError("Session expired. Please log in again.");
    navigate("/login");
  }, [clearStorage, navigate]);

  const login = (newToken: string, userInfo: UserInfo) => {
    setToken(newToken);
    setUser(userInfo);
    setAuthError(null);

    try {
      // persist in localStorage (so app remains logged in on refresh)
      localStorage.setItem("token", newToken);
      localStorage.setItem("user", JSON.stringify(userInfo));
    } catch (err) {
      console.warn("Could not persist auth in localStorage", err);
    }

    // Redirect to role dashboard
    if (userInfo.role === "athlete") navigate("/athlete-dashboard");
    else if (userInfo.role === "coach") navigate("/coach-dashboard");
    else if (userInfo.role === "admin") navigate("/admin-dashboard");
    else navigate("/login");
  };

  const checkAuth = useCallback(async (): Promise<boolean> => {
    const storedToken = localStorage.getItem("token") || sessionStorage.getItem("token");
    const storedUser = localStorage.getItem("user") || sessionStorage.getItem("user");

    if (!storedToken || !storedUser) {
      logout();
      return false;
    }

    setCheckingAuth(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      if (!response.ok) {
        logout();
        return false;
      }

      const body = await response.json();
      // backend returns either `user` or `data` -> be tolerant
      const apiUser = body.user || body.data || body.data?.user || null;

      if (!apiUser) {
        logout();
        return false;
      }

      // ensure id is string (backend uses UUID)
      const normalizedUser: UserInfo = {
        id: String(apiUser.id),
        username: apiUser.username,
        role: apiUser.role || "athlete",
        exp: apiUser.exp, // optional
      };

      setToken(storedToken);
      setUser(normalizedUser);
      setAuthError(null);
      return true;
    } catch (err) {
      console.error("❌ checkAuth failed:", err);
      logout();
      return false;
    } finally {
      setCheckingAuth(false);
    }
  }, [logout]);

  useEffect(() => {
    // on app start, validate token if present
    if (!user || !token) return;
    checkAuth();
  }, []); // run once

  // loginUser: used by non-React login flows — calls backend and stores token/user
  const loginUser = async (usernameOrEmail: string, password: string): Promise<boolean> => {
    try {
      const resp = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameOrEmail.trim(), password }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        console.warn("Login failed:", resp.status, errBody);
        setAuthError(errBody.message || "Login failed");
        return false;
      }

      const body = await resp.json();
      const access_token = body.access_token || body.data?.access_token || body.data?.token || body.token;
      const apiUser = body.user || body.data?.user || body.data || null;

      if (!access_token || !apiUser) {
        setAuthError("Invalid server response during login.");
        return false;
      }

      const userInfo: UserInfo = { id: String(apiUser.id), username: apiUser.username, role: apiUser.role || "athlete" };
      login(access_token, userInfo);
      return true;
    } catch (err) {
      console.error("❌ loginUser failed:", err);
      setAuthError("Network error during login.");
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
  ): Promise<boolean> => {
    try {
      const resp = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, name, dob, sport, gender, contact_info, role: "athlete" }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        setAuthError(errBody.message || "Registration failed");
        return false;
      }

      // Optionally auto-login after register:
      // try to login immediately with the provided credentials
      return await loginUser(username, password);
    } catch (err) {
      console.error("❌ registerUser failed:", err);
      setAuthError("Network error during registration.");
      return false;
    }
  };

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        authError,
        login,
        logout,
        isAuthenticated,
        checkingAuth,
        checkAuth,
        loginUser,
        registerUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};