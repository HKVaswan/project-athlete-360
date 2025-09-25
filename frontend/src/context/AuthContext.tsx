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
  }, [clearStorage]);

  const checkTokenExpiry = useCallback(
    (exp?: number) => {
      if (!exp) return true;
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

      const apiUser: UserInfo = data.data || parsedUser;

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
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userInfo));

      if (userInfo.role === 'athlete') navigate('/athlete-dashboard');
      else if (userInfo.role === 'coach') navigate('/coach-dashboard');
      else if (userInfo.role === 'admin') navigate('/admin-dashboard');
      else {
        console.warn('⚠️ Unknown role during login:', userInfo.role);
        navigate('/login');
      }
    } catch (err) {
      console.error('❌ Error during login storage:', err);
      navigate('/login');
    }
  };

  // ✅ Login User
  const loginUser = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error('Invalid credentials');
      const data = await response.json();

      if (!data.success) throw new Error(data.message);

      const token = data.data.token;
      const role = data.data.role || 'athlete';

      const dummyUser: UserInfo = {
        id: 0,
        username,
        role,
        exp: Date.now() / 1000 + 3600,
      };

      login(token, dummyUser);
      return true;
    } catch (err) {
      console.error('❌ Login failed:', err);
      setAuthError('Login failed. Check credentials.');
      return false;
    }
  };

  // ✅ Register User
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
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      if (!response.ok) throw new Error('Registration failed');
      const data = await response.json();

      if (!data.success) throw new Error(data.message);

      const role = data.data.user.role || 'athlete';
      const dummyUser: UserInfo = {
        id: 0,
        username,
        role,
        exp: Date.now() / 1000 + 3600,
      };

      const token = data.data.token || '';
      if (token) login(token, dummyUser);

      return true;
    } catch (err) {
      console.error('❌ Registration failed:', err);
      setAuthError('Registration failed. Please check your details.');
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
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};