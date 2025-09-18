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
  login: (token: string, role: string, username: string, userId: number, exp: number) => void;
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
      console.log("Token expired. Logging out.");
      logout();
      return false;
    }
    return true;
  }, [logout]);

  const checkAuth = useCallback(async () => {
    const { storedToken, storedUser } = getStorage();

    if (!storedToken || !storedUser) {
      return logout();
    }
    
    try {
      const parsedUser = JSON.parse(storedUser);
      // Validate the stored expiration time before calling the backend
      if (!checkTokenExpiry(parsedUser.exp)) {
        return;
      }

      // Verify the token with the backend, and get the authoritative `exp` value
      const response = await fetch(`${API_URL}/api/me`, {
        headers: { 'Authorization': `Bearer ${storedToken}` }
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Backend rejected token');
      }

      // Authoritative check on the token's expiration from the backend
      const backendExp = data.user.exp;
      if (!checkTokenExpiry(backendExp)) {
        return;
      }
      
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
    checkAuth();
  }, [checkAuth]);

  const login = (newToken: string, role: string, username: string, userId: number, exp: number) => {
    setToken(newToken);
    const userInfo: UserInfo = { id: userId, username, role, exp };
    setUser(userInfo);
    setAuthError(null);

    if (role === 'athlete') {
      sessionStorage.setItem('token', newToken);
      sessionStorage.setItem('user', JSON.stringify(userInfo));
    } else {
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userInfo));
    }

    if (role === 'athlete') {
      navigate('/athletes');
    } else if (role === 'coach') {
      navigate('/coach-dashboard');
    } else if (role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/login');
    }
  };

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider value={{ token, user, authError, login, logout, isAuthenticated, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
