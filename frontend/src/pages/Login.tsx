import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaSignInAlt, FaSpinner, FaCheckCircle, FaEye, FaEyeSlash } from 'react-icons/fa';

// Use your environment variable or default API URL
const API_URL = (process.env.REACT_APP_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 6;

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  let authContext;
  try {
    authContext = useAuth();
  } catch (err) {
    // If useAuth throws, show a visible error for debugging
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-100">
        <div className="bg-white rounded-lg shadow p-8 max-w-lg">
          <h2 className="text-xl font-bold text-red-700 mb-4">Critical Error</h2>
          <p className="text-red-600">Authentication context is not available. Make sure your App is wrapped in <code>AuthProvider</code> and <code>Router</code>.</p>
          <pre className="mt-4 text-xs text-red-500">{String(err)}</pre>
        </div>
      </div>
    );
  }

  // Defensive fallback if context is undefined
  const login = authContext?.login;
  const contextLoading = authContext?.loading ?? false;
  const contextError = authContext?.error ?? null;

  const usernameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

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

    let response;
    try {
      response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
    } catch (networkErr) {
      setError("Network error. Could not reach login server.");
      setLoading(false);
      return;
    }

    // Defensive: Handle no response
    if (!response) {
      setError("No response from login server.");
      setLoading(false);
      return;
    }

    let data: any = {};
    try {
      data = await response.json();
    } catch (jsonErr) {
      setError("Server returned an invalid response. Please contact support.");
      setLoading(false);
      return;
    }

    // Defensive: Check structure
    if (!('success' in data) || (!data.success && !data.message)) {
      setError("Unexpected server response. Please contact support.");
      setLoading(false);
      return;
    }

    if (response.ok && data.success && data.data && data.data.token && data.data.role) {
      setSuccess(true);
      try {
        login(data.data.token); // Defensive: context login
        setTimeout(() => navigate(`/${data.data.role}-dashboard`), 1200);
      } catch (err) {
        setError("Critical auth error. Please reload the page.");
        setSuccess(false);
      }
    } else {
      // Defensive: Message handling
      if (data.message) {
        if (typeof data.message === 'string' && data.message.toLowerCase().includes('credentials')) {
          setError('Incorrect username or password.');
        } else {
          setError(data.message || 'Login failed. Please try again.');
        }
      } else {
        setError('Login failed. Please try again.');
      }
      usernameRef.current?.focus();
    }
    setLoading(false);
  };

  // Context loading/error UI
  if (contextLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <FaSpinner className="animate-spin text-4xl text-blue-600" />
        <span className="ml-4 text-lg text-gray-700">Loading authentication…</span>
      </div>
    );
  }
  if (contextError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-100">
        <div className="bg-white rounded-lg shadow p-8 max-w-lg">
          <h2 className="text-xl font-bold text-red-700 mb-4">Authentication Error</h2>
          <p className="text-red-600">{contextError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 sm:p-10 w-full max-w-lg transition-all duration-300 transform scale-95 md:scale-100">
        <div className="text-center mb-8">
          <FaSignInAlt className="mx-auto text-4xl text-blue-600 dark:text-blue-400 mb-3" />
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
            Welcome Back!
          </h1>
          <p className="text-gray-500 dark:text-gray-400">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              ref={usernameRef}
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
              placeholder="Enter your username"
              required
              minLength={MIN_USERNAME_LENGTH}
              autoFocus
              aria-label="Username"
            />
          </div>
          <div className="relative">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
              placeholder="Enter your password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Password"
            />
            <button
              type="button"
              className="absolute right-3 top-2 text-gray-600 dark:text-gray-300"
              onClick={() => setShowPassword((show) => !show)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
          {error && (
            <div
              ref={errorRef}
              tabIndex={-1}
              className="text-center text-sm text-red-500 bg-red-100 dark:bg-red-900 p-3 rounded-md"
              aria-live="assertive"
            >
              {error}
            </div>
          )}
          {success && (
            <div className="text-center text-green-600 bg-green-100 dark:bg-green-900 p-3 rounded-md flex items-center justify-center space-x-2">
              <FaCheckCircle />
              <span>Login successful! Redirecting…</span>
            </div>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:bg-blue-400 disabled:cursor-not-allowed"
            disabled={loading}
            aria-label="Sign In"
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
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-colors"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;