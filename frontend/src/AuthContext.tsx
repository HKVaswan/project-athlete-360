import React, { createContext, useState, useEffect, useContext } from 'react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

interface DecodedUser {
  exp?: number;
  [key: string]: any;
}

interface AuthContextType {
  token: string | null;
  user: DecodedUser | null;
  isAuthReady: boolean; // Added for loading state
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Defensive JWT decoding
const safeDecode = (token: string): DecodedUser | null => {
  try {
    return jwtDecode<DecodedUser>(token);
  } catch (e) {
    console.error('JWT decode error:', e);
    return null;
  }
};

const isTokenValid = (decoded: DecodedUser | null): boolean =>
  !!decoded?.exp && decoded.exp * 1000 > Date.now();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<DecodedUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false); // New state variable
  const navigate = useNavigate();

  // Load token at startup
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      const decoded = safeDecode(storedToken);
      if (isTokenValid(decoded)) {
        setToken(storedToken);
        setUser(decoded);
      } else {
        localStorage.removeItem('token');
      }
    }
    setIsAuthReady(true); // Set state to true when check is complete
  }, []);

  // Sync auth state across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'token') {
        const newToken = e.newValue;
        const decoded = newToken ? safeDecode(newToken) : null;
        if (newToken && isTokenValid(decoded)) {
          setToken(newToken);
          setUser(decoded);
        } else {
          setToken(null);
          setUser(null);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Auto-logout on token expiry
  useEffect(() => {
    if (user?.exp) {
      const delay = user.exp * 1000 - Date.now();
      if (delay > 0) {
        const timeout = setTimeout(() => logout(), delay + 1000);
        return () => clearTimeout(timeout);
      }
    }
  }, [user]);

  const login = (jwtToken: string) => {
    const decoded = safeDecode(jwtToken);
    if (!isTokenValid(decoded)) {
      throw new Error('Token is invalid or expired');
    }
    localStorage.setItem('token', jwtToken);
    setToken(jwtToken);
    setUser(decoded);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    if (window.location.pathname !== '/login') {
      navigate('/login');
    }
  };

  const isAuthenticated = (): boolean => {
    if (!token) return false;
    const decoded = safeDecode(token);
    return isTokenValid(decoded);
  };

  return (
    <AuthContext.Provider value={{ token, user, isAuthReady, login, logout, isAuthenticated }}>
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
