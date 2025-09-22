// src/pages/AthleteProfile.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { FaEdit, FaPlusCircle, FaSpinner } from 'react-icons/fa';
import AddSessionAndMetric from '../components/AddSessionAndMetric';

const API_URL = import.meta.env.VITE_API_URL;

interface TrainingSession {
  id: string;
  session_date: string;
  notes: string;
}

interface PerformanceMetric {
  id: string;
  metric_name: string;
  metric_value: string | number;
  entry_date: string;
  notes?: string;
}

interface Athlete {
  id: string;
  name: string;
  sport: string;
  dob: string;
  gender: string;
  contact_info: string;
  training_sessions: TrainingSession[];
  performance_metrics: PerformanceMetric[];
}

const AthleteProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForms, setShowAddForms] = useState(false);

  const fetchAthleteProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/athletes/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        logout();
        return;
      }

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to fetch athlete profile.');
      }

      const { data } = await response.json();
      setAthlete(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching the profile.');
    } finally {
      setLoading(false);
    }
  }, [id, token, logout]);

  useEffect(() => {
    fetchAthleteProfile();
  }, [fetchAthleteProfile]);

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-xl text-blue-500">
        <FaSpinner className="animate-spin mr-2 text-2xl" /> Loading...
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-500 text-center">{error}</div>;
  }

  if (!athlete) {
    return <div className="p-4 text-center text-gray-500">Athlete not found.</div>;
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">{athlete.name}'s Profile</h1>
        <div className="flex space-x-2">
          {isCoachOrAdmin && (
            <button
              onClick={() => navigate(`/athletes/edit/${id}`)}
              className="bg-yellow-500 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded flex items-center space-x-2"
            >
              <FaEdit /> <span>Edit Profile</span>
            </button>
          )}
          {isCoachOrAdmin && (
            <button
              onClick={() => setShowAddForms(!showAddForms)}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded flex items-center space-x-2"
            >
              <FaPlusCircle />
              <span>{showAddForms ? 'Hide Forms' : 'Add Data'}</span>
            </button>
          )}
        </div>
      </div>

      {showAddForms && (
        <div className="mb-6">
          <AddSessionAndMetric athleteId={athlete.id} onDataAdded={fetchAthleteProfile} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Personal Details */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md md:col-span-1">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Personal Details</h2>
          <p><strong>Sport:</strong> {athlete.sport || 'Not provided'}</p>
          <p><strong>Date of Birth:</strong> {athlete.dob ? format(new Date(athlete.dob), 'MMMM d, yyyy') : 'Not provided'}</p>
          <p><strong>Gender:</strong> {athlete.gender || 'Not provided'}</p>
          <p><strong>Contact Info:</strong> {athlete.contact_info || 'Not provided'}</p>
        </div>

        {/* Training Sessions */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md md:col-span-2">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Training Sessions</h2>
          {athlete.training_sessions.length > 0 ? (
            <ul className="space-y-4">
              {athlete.training_sessions.map((session) => (
                <li key={session.id} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border">
                  {session.session_date && (
                    <p className="font-semibold">{format(new Date(session.session_date), 'MMMM d, yyyy h:mm a')}</p>
                  )}
                  <p>{session.notes}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No training sessions recorded.</p>
          )}
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Performance Metrics</h2>
        {athlete.performance_metrics.length > 0 ? (
          <ul className="space-y-4">
            {athlete.performance_metrics.map((metric) => (
              <li key={metric.id} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border">
                <p className="font-semibold">{metric.metric_name}: {metric.metric_value}</p>
                {metric.notes && <p className="text-sm italic mt-1 text-gray-600 dark:text-gray-300">Notes: {metric.notes}</p>}
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Recorded on {format(new Date(metric.entry_date), 'MMMM d, yyyy')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">No performance metrics recorded.</p>
        )}
      </div>
    </div>
  );
};

export default AthleteProfile;