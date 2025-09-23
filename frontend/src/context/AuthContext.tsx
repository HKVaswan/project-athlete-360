// src/context/AuthContext.tsx
import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

interface UserInfo {
  id: number;
  username: string;
  role: string;
  exp: number;
}

interface AuthContextType {
  token: string | null;
  user: UserInfo | null;
  authError: string | null;
  login: (token: string, user: UserInfo) => void;
  logout: () => void;
  isAuthenticated: boolean;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();

  const getStorage = useCallback(() => {
    const storedToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    const storedUser = sessionStorage.getItem('user') || localStorage.getItem('user');
    return { storedToken, storedUser };
  }, []);

  const clearStorage = useCallback(() => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStorage();
    setAuthError("Session expired. Please log in again.");
    navigate('/login');
  }, [navigate, clearStorage]);

  const checkTokenExpiry = useCallback((exp: number) => {
    if (exp * 1000 < Date.now()) {
      console.warn("Token expired:", exp);
      logout();
      return false;
    }
    return true;
  }, [logout]);

  const checkAuth = useCallback(async () => {
    const { storedToken, storedUser } = getStorage();

    if (!storedToken || !storedUser) {
      console.warn("No token or user in storage");
      logout();
      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as UserInfo;
      console.log("Parsed user from storage:", parsedUser);

      if (!checkTokenExpiry(parsedUser.exp)) return;

      const response = await fetch(`${API_URL}/api/me`, {
        headers: { 'Authorization': `Bearer ${storedToken}` },
      });

      if (!response.ok) {
        console.warn("Auth API responded with error:", response.status);
        logout();
        return;
      }

      const data = await response.json();
      console.log("Auth API response:", data);

      if (!data.user) {
        console.warn("No user in API response");
        logout();
        return;
      }

      if (!checkTokenExpiry(data.user.exp)) return;

      setToken(storedToken);
      setUser(parsedUser);
      setAuthError(null);
    } catch (error) {
      console.error("Authentication check failed:", error);
      setAuthError("Network or session error. Please log in again.");
      logout();
    }
  }, [logout, checkTokenExpiry, getStorage]);

  useEffect(() => {
    const path = window.location.pathname;
    if (path !== '/login' && path !== '/register') {
      checkAuth();
    }
  }, [checkAuth]);

  const login = (newToken: string, userInfo: UserInfo) => {
    setToken(newToken);
    setUser(userInfo);
    setAuthError(null);

    try {
      if (userInfo.role === 'athlete') {
        sessionStorage.setItem('token', newToken);
        sessionStorage.setItem('user', JSON.stringify(userInfo));
        navigate('/athlete-dashboard');
      } else if (userInfo.role === 'coach') {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(userInfo));
        navigate('/coach-dashboard');
      } else if (userInfo.role === 'admin') {
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(userInfo));
        navigate('/admin-dashboard');
      } else {
        console.warn("Unknown role during login:", userInfo.role);
        navigate('/login');
      }
    } catch (err) {
      console.error("Error during login storage:", err);
      navigate('/login');
    }
  };

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{ token, user, authError, login, logout, isAuthenticated, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};