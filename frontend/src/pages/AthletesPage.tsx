import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL;

const AthletesPage: React.FC = () => {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const [athletes, setAthletes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAthletes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/athletes`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to fetch athletes.');
      }

      const { data } = await response.json();
      setAthletes(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    fetchAthletes();
  }, [fetchAthletes]);

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';

  if (loading) return <div className="p-4 text-center">Loading...</div>;
  if (error) return <div className="p-4 text-red-500 text-center">{error} <button onClick={fetchAthletes} className="ml-2 underline">Retry</button></div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">My Athletes</h1>
        {isCoachOrAdmin && (
          <Link
            to="/add-athlete"
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
          >
            Add New Athlete
          </Link>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        {athletes.length === 0 ? (
          <p className="text-gray-500 text-center">No athletes found.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {athletes.map((athlete) => (
              <li key={athlete.id} className="py-4 flex items-center justify-between">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-gray-800">{athlete.name}</h2>
                  <p className="text-gray-500">{athlete.sport}</p>
                </div>
                <div className="flex space-x-2">
                  <Link
                    to={`/athletes/${athlete.id}`}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                  >
                    View
                  </Link>
                  <Link
                    to={`/athletes/edit/${athlete.id}`}
                    className="bg-yellow-500 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AthletesPage;
