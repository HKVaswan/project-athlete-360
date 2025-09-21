import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaSignInAlt, FaSpinner, FaCheckCircle } from 'react-icons/fa';

const API_URL = (process.env.REACT_APP_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!username || !password) {
      setError("Please enter a username and password.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      // Handle non-fetch errors, like server not reachable
      if (!response) {
        setError("Cannot reach login server. Try again later.");
        setLoading(false);
        return;
      }

      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        setError("Server returned an invalid response. Please contact support.");
        setLoading(false);
        return;
      }

      if (response.ok && (data as any).success) {
        // Use the login function from AuthContext to set the user and token
        login((data as any).data.token);
        navigate(`/${(data as any).data.role}-dashboard`);
      } else {
        setError((data as any).message || 'Login failed. Please check your credentials.');
      }
    } catch (err: any) {
      setError('Could not connect to login server. Please check your internet or try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 sm:p-10 w-full max-w-lg transition-all duration-300 transform scale-95 md:scale-100">
        <div className="text-center mb-8">
          <FaSignInAlt className="mx-auto text-4xl text-blue-600 dark:text-blue-400 mb-3" />
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
            Welcome Back!
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Sign in to your account
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="Enter your username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="Enter your password"
              required
            />
          </div>
          {error && (
            <div className="text-center text-sm text-red-500 bg-red-100 dark:bg-red-900 p-3 rounded-md">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:bg-blue-400 disabled:cursor-not-allowed"
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
