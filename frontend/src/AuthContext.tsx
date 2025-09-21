import React, { createContext, useState, useEffect, useContext } from 'react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  token: string | null;
  user: any;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

  // Load the token and user from localStorage on initial render
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        const decodedUser = jwtDecode(storedToken);
        // Check if token is expired
        if (decodedUser.exp && decodedUser.exp * 1000 > Date.now()) {
          setToken(storedToken);
          setUser(decodedUser);
        } else {
          // Token is expired, clear it
          localStorage.removeItem('token');
        }
      }
    } catch (e) {
      console.error("Failed to decode token from localStorage", e);
      localStorage.removeItem('token');
    }
  }, []);

  const login = (jwtToken: string) => {
    localStorage.setItem('token', jwtToken);
    setToken(jwtToken);
    const decodedUser = jwtDecode(jwtToken);
    setUser(decodedUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  const isAuthenticated = () => {
    if (!token) return false;
    try {
      const decodedUser = jwtDecode(token);
      return decodedUser.exp && decodedUser.exp * 1000 > Date.now();
    } catch (e) {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated }}>
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
