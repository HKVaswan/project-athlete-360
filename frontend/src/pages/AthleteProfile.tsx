import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL;

const AthleteProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const [athlete, setAthlete] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAthlete = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/athletes/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch athlete profile.');
      }

      const data = await response.json();
      setAthlete(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching the profile.');
    } finally {
      setLoading(false);
    }
  }, [id, token, logout]);

  useEffect(() => {
    fetchAthlete();
  }, [fetchAthlete]);

  if (loading) return <div className="p-4">Loading...</div>;

  if (error) return (
    <div className="p-4 text-red-500">
      {error}
      <button onClick={fetchAthlete} className="ml-2 underline text-blue-600">
        Retry
      </button>
    </div>
  );

  if (!athlete) return <div className="p-4">No athlete found.</div>;

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';

  return (
    <div className="p-4">
      {isCoachOrAdmin && (
        <button
          onClick={() => navigate('/athletes')}
          className="mb-4 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded"
        >
          &larr; Back to Athletes List
        </button>
      )}
      <h1 className="text-2xl font-bold mb-4">{athlete?.name || 'Athlete'}'s Profile</h1>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p><strong>Sport:</strong> {athlete?.sport || 'Not provided'}</p>
        <p>
          <strong>Date of Birth:</strong>{' '}
          {athlete?.dob ? new Date(athlete.dob).toLocaleDateString() : 'Not provided'}
        </p>
        <p><strong>Gender:</strong> {athlete?.gender || 'Not provided'}</p>
        <p><strong>Contact Info:</strong> {athlete?.contact_info || 'Not provided'}</p>
      </div>
      {/* Forms for adding training sessions and metrics will go here */}
    </div>
  );
};

export default AthleteProfile;
