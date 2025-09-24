// src/context/AuthContext.tsx
import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
  useCallback,
} from 'react';
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
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();

  const getStorage = useCallback(() => {
    const storedToken =
      sessionStorage.getItem('token') || localStorage.getItem('token');
    const storedUser =
      sessionStorage.getItem('user') || localStorage.getItem('user');
    return { storedToken, storedUser };
  }, []);

  const clearStorage = useCallback(() => {
    sessionStorage.clear();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStorage();
    setAuthError('Session expired. Please log in again.');
    // ⚠️ don’t force navigate instantly → let Layout handle redirect
  }, [clearStorage]);

  const checkTokenExpiry = useCallback(
    (exp?: number) => {
      if (!exp) return true; // if API doesn’t return exp, skip
      if (exp * 1000 < Date.now()) {
        console.warn('⚠️ Token expired at', exp);
        logout();
        return false;
      }
      return true;
    },
    [logout]
  );

  const checkAuth = useCallback(async (): Promise<boolean> => {
    const { storedToken, storedUser } = getStorage();

    if (!storedToken || !storedUser) {
      console.warn('⚠️ No token or user in storage');
      logout();
      return false;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as UserInfo;
      if (!checkTokenExpiry(parsedUser.exp)) return false;

      const response = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      if (!response.ok) {
        console.warn('⚠️ Auth API responded with', response.status);
        logout();
        return false;
      }

      const data = await response.json();
      console.log('✅ Auth API response:', data);

      // trust backend first
      const apiUser: UserInfo = data.user || parsedUser;

      if (!checkTokenExpiry(apiUser.exp)) return false;

      setToken(storedToken);
      setUser(apiUser);
      setAuthError(null);
      return true;
    } catch (error) {
      console.error('❌ Authentication check failed:', error);
      setAuthError('Network or session error.');
      logout();
      return false;
    }
  }, [logout, checkTokenExpiry, getStorage]);

  useEffect(() => {
    // only check auth if not on login/register
    const path = window.location.pathname;
    if (!['/login', '/register'].includes(path)) {
      checkAuth();
    }
  }, [checkAuth]);

  const login = (newToken: string, userInfo: UserInfo) => {
    setToken(newToken);
    setUser(userInfo);
    setAuthError(null);

    try {
      // ✅ store consistently in localStorage
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userInfo));

      if (userInfo.role === 'athlete') {
        navigate('/athlete-dashboard');
      } else if (userInfo.role === 'coach') {
        navigate('/coach-dashboard');
      } else if (userInfo.role === 'admin') {
        navigate('/admin-dashboard');
      } else {
        console.warn('⚠️ Unknown role during login:', userInfo.role);
        navigate('/login');
      }
    } catch (err) {
      console.error('❌ Error during login storage:', err);
      navigate('/login');
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
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};