import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

const AthletesPage: React.FC = () => {
  const { token, user, logout } = useAuth();
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const fetchAthletes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = user?.role === 'athlete'
        ? `${API_URL}/api/athletes/${user.id}`
        : `${API_URL}/api/athletes?limit=${limit}&offset=${offset}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        logout();
        return;
      }
      
      if (response.status === 403) {
        throw new Error('You do not have permission to view this page.');
      }
      if (!response.ok) {
        throw new Error('Failed to fetch athlete data.');
      }

      const data = await response.json();

      // Handle both array and single object responses
      if (user?.role === 'athlete') {
        setAthletes([data]);
      } else {
        setAthletes(data);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data.');
    } finally {
      setLoading(false);
    }
  }, [user, token, limit, offset, logout]);

  useEffect(() => {
    fetchAthletes();
  }, [fetchAthletes]);

  const handleNext = () => {
    setOffset(prevOffset => prevOffset + limit);
  };

  const handlePrevious = () => {
    setOffset(prevOffset => Math.max(0, prevOffset - limit));
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return (
    <div className="p-4 text-red-500">
      {error}
      <button onClick={fetchAthletes} className="ml-2 underline text-blue-600">
        Retry
      </button>
    </div>
  );

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">
        {user?.role === 'athlete' ? 'Your Profile' : 'Athletes List'}
      </h1>
      <ul className="space-y-2">
        {athletes.length > 0 ? (
          athletes.map((athlete: any) => (
            <li key={athlete.id} className="p-4 bg-gray-100 rounded-lg shadow-sm">
              <Link to={`/athletes/${athlete.id}`} className="text-blue-600 hover:underline">
                {athlete.name}
              </Link>
            </li>
          ))
        ) : (
          <p className="text-gray-500">
            {isCoachOrAdmin ? 'No athletes available.' : 'No profile found.'}
          </p>
        )}
      </ul>
      {isCoachOrAdmin && (
        <div className="flex justify-between mt-4">
          <button
            onClick={handlePrevious}
            disabled={offset === 0}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-l disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={handleNext}
            disabled={athletes.length < limit}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-r disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default AthletesPage;
