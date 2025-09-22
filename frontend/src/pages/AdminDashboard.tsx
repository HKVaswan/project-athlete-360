// src/pages/AdminDashboard.tsx
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
      console.error(err);
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
        <FaSpinner className="animate-spin mr-2 text-2xl" />
        Loading admin dashboard...
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center mt-6">{error}</div>;
  }

  const dashboardCards = [
    {
      icon: <FaChartPie className="text-blue-500 text-5xl mb-4" />,
      title: 'Total Users',
      description: userCount ?? 'N/A',
      link: '',
      clickable: false,
    },
    {
      icon: <FaUsers className="text-green-500 text-5xl mb-4" />,
      title: 'Manage Athletes',
      description: 'View, edit, or delete athlete profiles.',
      link: '/athletes',
      clickable: true,
    },
    {
      icon: <FaUserCog className="text-orange-500 text-5xl mb-4" />,
      title: 'Manage Coaches',
      description: 'Review and manage coach accounts.',
      link: '/manage-coaches',
      clickable: true,
    },
    {
      icon: <FaUserPlus className="text-purple-500 text-5xl mb-4" />,
      title: 'Add New User',
      description: 'Create a new account for any role.',
      link: '/users/add',
      clickable: true,
    },
  ];

  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">
        Admin Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {dashboardCards.map((card, idx) =>
          card.clickable ? (
            <Link
              key={idx}
              to={card.link}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center transition-transform transform hover:scale-105"
            >
              {card.icon}
              <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">{card.title}</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">{card.description}</p>
            </Link>
          ) : (
            <div
              key={idx}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center"
            >
              {card.icon}
              <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">{card.title}</h2>
              <p className="text-gray-500 dark:text-gray-400 text-6xl font-extrabold mt-2">{card.description}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;