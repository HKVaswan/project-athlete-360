// src/pages/Login.tsx
import React, { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  FaSignInAlt,
  FaSpinner,
  FaCheckCircle,
  FaEye,
  FaEyeSlash,
  FaExclamationTriangle,
} from "react-icons/fa";
import SEO from "../components/SEO";

// Use your environment variable or fallback URL
const API_URL = (process.env.REACT_APP_API_URL || "https://project-athlete-360.onrender.com/").replace(/\/+$/, "");

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 6;

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const { login } = useAuth() ?? {};

  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);

  const validateForm = () => {
    if (username.trim().length < MIN_USERNAME_LENGTH)
      return `Username must be at least ${MIN_USERNAME_LENGTH} characters.`;
    if (password.length < MIN_PASSWORD_LENGTH)
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setLoading(false);
      usernameRef.current?.focus();
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username.trim(), password }),
      });

      if (!response.ok) {
        setError("Incorrect username or password.");
        return;
      }

      const data = await response.json();
      if (!data.access_token) {
        setError("Login failed. Invalid server response.");
        return;
      }

      login?.(data.access_token);

      setSuccess(true);
      setTimeout(() => navigate("/athlete-dashboard"), 1200);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState("CapsLock"));
  };

  return (
    <>
      {/* ✅ SEO Component */}
      <SEO
        title="Login - Project Athlete 360"
        description="Access your Project Athlete 360 account to manage athletes, sessions, and performance."
        url="https://projectathlete360.com/login"
      />

      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 sm:p-10 w-full max-w-lg transition-all duration-300">
          {/* Header */}
          <div className="text-center mb-8">
            <FaSignInAlt className="mx-auto text-4xl text-blue-600 dark:text-blue-400 mb-3" />
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
              Welcome Back!
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Sign in to your account
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="space-y-6"
            autoComplete="off"
            noValidate
          >
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                ref={usernameRef}
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900"
                placeholder="Enter your username"
                required
                minLength={MIN_USERNAME_LENGTH}
                autoFocus
              />
            </div>

            {/* Password */}
            <div className="relative">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={handleCapsLock}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900"
                placeholder="Enter your password"
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
              <button
                type="button"
                className="absolute right-3 top-9 text-gray-600 dark:text-gray-300"
                onClick={() => setShowPassword((show) => !show)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            {/* Caps Lock Warning */}
            {capsLock && (
              <div className="text-yellow-600 bg-yellow-100 dark:bg-yellow-900 p-2 rounded-md text-sm flex items-center gap-2">
                <FaExclamationTriangle />
                <span>Caps Lock is on</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                ref={errorRef}
                tabIndex={-1}
                className="text-center text-sm text-red-600 bg-red-100 dark:bg-red-900 p-3 rounded-md flex items-center justify-center gap-2"
                aria-live="assertive"
              >
                <FaExclamationTriangle />
                <span>{error}</span>
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="text-center text-green-600 bg-green-100 dark:bg-green-900 p-3 rounded-md flex items-center justify-center gap-2">
                <FaCheckCircle />
                <span>Login successful! Redirecting…</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:bg-blue-400 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <>
                  <FaSpinner className="animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <FaSignInAlt />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Don&apos;t have an account?{" "}
            <Link
              to="/register"
              className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-colors"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default Login;