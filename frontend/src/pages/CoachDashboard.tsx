// src/pages/CoachDashboard.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { FaUserPlus, FaUsers, FaChartLine, FaSpinner } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL;

interface AthleteSummary {
  id: string;
  name: string;
  sport: string;
}

const CoachDashboard: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentAthletes, setRecentAthletes] = useState<AthleteSummary[]>([]);
  const [totalAthletes, setTotalAthletes] = useState<number>(0);
  const navigate = useNavigate();

  const fetchRecentAthletes = useCallback(async () => {
    if (!user || user.role !== 'coach') {
      navigate('/login');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/athletes?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) throw new Error('Failed to fetch recent athletes.');

      const { data } = await response.json();
      setRecentAthletes(data);
      setTotalAthletes(data.length); // for now using count of recent; ideally fetch full count from API
    } catch (err: any) {
      setError(err.message || 'Failed to load athlete data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user, token, navigate, logout]);

  useEffect(() => {
    fetchRecentAthletes();
  }, [fetchRecentAthletes]);

  // Skeleton loader component
  const LoadingSkeleton = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="p-4 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg h-24"
        />
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xl text-blue-500 p-4">
        <FaSpinner className="animate-spin mr-2" />
        Loading coach dashboard...
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
          Hello, {user?.username}!
        </h1>
      </div>

      {error && (
        <div className="text-center mt-4 text-red-500">
          {error}
          <button
            onClick={fetchRecentAthletes}
            className="ml-2 underline text-blue-600"
          >
            Retry
          </button>
        </div>
      )}

      {/* Quick Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center">
          <FaUsers className="text-blue-500 text-5xl mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            Total Athletes
          </h2>
          <p className="text-3xl font-bold text-gray-700 dark:text-gray-200 mt-2">
            {totalAthletes}
          </p>
        </div>
        {/* Additional metrics can be added here */}
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Link
          to="/athletes/add"
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105"
        >
          <FaUserPlus className="text-green-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            Add New Athlete
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            Quickly add a new athlete to your roster.
          </p>
        </Link>

        <Link
          to="/athletes"
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105"
        >
          <FaUsers className="text-blue-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            View All Athletes
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            Manage and view profiles for your entire team.
          </p>
        </Link>
      </div>

      {/* Recent Athletes Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center space-x-2">
          <FaChartLine className="text-purple-500" />
          <span>Recent Athletes</span>
        </h2>
        {loading ? (
          <LoadingSkeleton />
        ) : recentAthletes.length > 0 ? (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentAthletes.map((athlete) => (
              <li
                key={athlete.id}
                className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <Link to={`/athletes/${athlete.id}`} className="block">
                  <p className="font-semibold text-lg text-blue-600 hover:text-blue-500 transition-colors">
                    {athlete.name}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    {athlete.sport}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            No athletes found. Add an athlete to get started.
          </p>
        )}
      </div>
    </div>
  );
};

export default CoachDashboard;