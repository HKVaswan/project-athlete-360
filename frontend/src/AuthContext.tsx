import React, { createContext, useState, useEffect, useContext } from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";

// Define the shape of the user decoded from JWT
interface DecodedUser {
  exp?: number;
  role?: string;
  [key: string]: any;
}

interface AuthContextType {
  token: string | null;
  user: DecodedUser | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Defensive JWT decoding
const safeDecode = (token: string): DecodedUser | null => {
  if (!token) return null;
  try {
    return jwtDecode<DecodedUser>(token);
  } catch (err) {
    console.error("JWT decode error:", err);
    return null;
  }
};

const isTokenValid = (decoded: DecodedUser | null): boolean =>
  !!decoded?.exp && decoded.exp * 1000 > Date.now() && !!decoded?.role;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<DecodedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Load token from localStorage on mount
  useEffect(() => {
    setLoading(true);
    let storedToken: string | null = null;
    try {
      storedToken = localStorage.getItem("token");
    } catch (e) {
      setError("Could not access local storage. Please check your browser settings.");
      setLoading(false);
      return;
    }

    if (storedToken) {
      const decoded = safeDecode(storedToken);
      if (isTokenValid(decoded)) {
        setToken(storedToken);
        setUser(decoded);
        setError(null);
      } else {
        localStorage.removeItem("token");
        setToken(null);
        setUser(null);
        setError("Session expired or invalid. Please log in again.");
      }
    } else {
      setToken(null);
      setUser(null);
      setError(null);
    }
    setLoading(false);
  }, []);

  // Multi-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "token") {
        const newToken = e.newValue;
        const decoded = newToken ? safeDecode(newToken) : null;
        if (newToken && isTokenValid(decoded)) {
          setToken(newToken);
          setUser(decoded);
          setError(null);
        } else {
          setToken(null);
          setUser(null);
          setError("Session expired or logged out elsewhere.");
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Auto-logout on expiry
  useEffect(() => {
    if (user?.exp) {
      const delay = user.exp * 1000 - Date.now();
      if (delay > 0) {
        const timeout = setTimeout(() => {
          logout();
          setError("Session expired. Please log in again.");
        }, delay + 500);
        return () => clearTimeout(timeout);
      } else {
        // Token already expired
        logout();
        setError("Session expired. Please log in again.");
      }
    }
    // eslint-disable-next-line
  }, [user]);

  const login = (jwtToken: string) => {
    setLoading(true);
    const decoded = safeDecode(jwtToken);
    if (!isTokenValid(decoded)) {
      setError("Invalid or expired login token.");
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      localStorage.setItem("token", jwtToken);
    } catch (e) {
      setError("Could not save login session. Check browser settings.");
      setLoading(false);
      return;
    }
    setToken(jwtToken);
    setUser(decoded);
    setError(null);
    setLoading(false);
  };

  const logout = () => {
    try {
      localStorage.removeItem("token");
    } catch (e) {
      setError("Could not clear session.");
    }
    setToken(null);
    setUser(null);
    setError(null);
    // Only navigate if not already on /login
    if (window.location.pathname !== "/login") {
      navigate("/login");
    }
  };

  const isAuthenticated = (): boolean => {
    if (loading) return false;
    if (!token) return false;
    const decoded = safeDecode(token);
    return isTokenValid(decoded);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        login,
        logout,
        isAuthenticated,
        loading,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook for using auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};