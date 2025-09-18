import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { FaUsers, FaUserCog, FaUserPlus, FaChartPie, FaSpinner } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL;

const AdminDashboard: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [userCount, setUserCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchUserCount = useCallback(async () => {
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/users/count`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch user count.');
      }

      const { data } = await response.json();
      setUserCount(data.count);
    } catch (err: any) {
      setError('Failed to load user data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user, token, navigate, logout]);

  useEffect(() => {
    fetchUserCount();
  }, [fetchUserCount]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xl text-blue-500">
        <FaSpinner className="animate-spin mr-2" />
        Loading admin dashboard...
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center">{error}</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">
        Admin Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {/* Total Users Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center">
          <FaChartPie className="text-blue-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            Total Users
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-6xl font-extrabold mt-2">
            {userCount ?? 'N/A'}
          </p>
        </div>

        {/* Manage Athletes Card */}
        <Link to="/athletes" className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105">
          <FaUsers className="text-green-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            Manage Athletes
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            View, edit, or delete athlete profiles.
          </p>
        </Link>
        
        {/* Manage Coaches Card */}
        <Link to="/manage-coaches" className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105">
          <FaUserCog className="text-orange-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            Manage Coaches
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            Review and manage coach accounts.
          </p>
        </Link>
        
        {/* Add User Card */}
        <Link to="/users/add" className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105">
          <FaUserPlus className="text-purple-500 text-5xl mb-4" />
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            Add New User
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            Create a new account for any role.
          </p>
        </Link>
      </div>
    </div>
  );
};

export default AdminDashboard;
