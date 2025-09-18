import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL;

const AthleteProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const [athlete, setAthlete] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states for training sessions
  const [trainingNotes, setTrainingNotes] = useState('');
  const [trainingFormError, setTrainingFormError] = useState<string | null>(null);
  const [isAddingTraining, setIsAddingTraining] = useState(false);

  // Form states for performance metrics
  const [metricName, setMetricName] = useState('');
  const [metricValue, setMetricValue] = useState('');
  const [metricFormError, setMetricFormError] = useState<string | null>(null);
  const [isAddingMetric, setIsAddingMetric] = useState(false);

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
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to fetch athlete profile.');
      }

      const { data } = await response.json();
      setAthlete(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching the profile.');
      console.error('Fetch error:', err); // Error logging
    } finally {
      setLoading(false);
    }
  }, [id, token, logout]);

  useEffect(() => {
    fetchAthlete();
  }, [fetchAthlete]);

  const handleAddTrainingSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingTraining(true);
    setTrainingFormError(null);

    // Client-side validation
    if (trainingNotes.trim().length < 5) {
      setTrainingFormError('Training notes must be at least 5 characters long.');
      setIsAddingTraining(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/training-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ athlete_id: id, notes: trainingNotes }),
      });

      const { success, data, message } = await response.json();

      if (!success) {
        throw new Error(message || 'Failed to add training session.');
      }

      // Optimistic Update: Add new session to state without re-fetching
      if (athlete) {
        const newSession = { ...data, session_date: new Date().toISOString() };
        setAthlete({
          ...athlete,
          training_sessions: [newSession, ...athlete.training_sessions],
        });
      }
      setTrainingNotes('');
    } catch (err: any) {
      setTrainingFormError(err.message || 'An error occurred.');
      console.error('Submission error:', err); // Error logging
    } finally {
      setIsAddingTraining(false);
    }
  };

  const handleAddMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingMetric(true);
    setMetricFormError(null);

    // Client-side validation
    if (metricName.trim().length < 3 || metricValue.trim().length === 0) {
      setMetricFormError('Metric name must be at least 3 characters. Metric value is required.');
      setIsAddingMetric(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/performance-metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ athlete_id: id, metric_name: metricName, metric_value: metricValue }),
      });

      const { success, data, message } = await response.json();

      if (!success) {
        throw new Error(message || 'Failed to add performance metric.');
      }

      // Optimistic Update
      if (athlete) {
        const newMetric = { ...data, entry_date: new Date().toISOString() };
        setAthlete({
          ...athlete,
          performance_metrics: [newMetric, ...athlete.performance_metrics],
        });
      }
      setMetricName('');
      setMetricValue('');
    } catch (err: any) {
      setMetricFormError(err.message || 'An error occurred.');
      console.error('Submission error:', err); // Error logging
    } finally {
      setIsAddingMetric(false);
    }
  };

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
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Personal Details Card */}
        <div className="bg-white p-6 rounded-lg shadow-md md:col-span-1">
          <h2 className="text-xl font-semibold mb-4">Personal Details</h2>
          <p><strong>Sport:</strong> {athlete?.sport || 'Not provided'}</p>
          <p>
            <strong>Date of Birth:</strong>{' '}
            {athlete?.dob ? format(new Date(athlete.dob), 'MMMM d, yyyy') : 'Not provided'}
          </p>
          <p><strong>Gender:</strong> {athlete?.gender || 'Not provided'}</p>
          <p><strong>Contact Info:</strong> {athlete?.contact_info || 'Not provided'}</p>
        </div>
        
        {/* Training Sessions Form & List */}
        <div className="bg-white p-6 rounded-lg shadow-md md:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Training Sessions</h2>
          {isCoachOrAdmin && (
            <form onSubmit={handleAddTrainingSession} className="mb-4">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Enter training notes"
                  value={trainingNotes}
                  onChange={(e) => setTrainingNotes(e.target.value)}
                  className="flex-1 border p-2 rounded"
                  disabled={isAddingTraining}
                />
                <button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 relative"
                  disabled={isAddingTraining}
                >
                  {isAddingTraining && <span className="absolute inset-0 flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </span>}
                  <span className={isAddingTraining ? 'invisible' : 'visible'}>Add Session</span>
                </button>
              </div>
              {trainingFormError && <p className="text-red-500 text-sm mt-2">{trainingFormError}</p>}
            </form>
          )}
          {athlete?.training_sessions?.length > 0 ? (
            <ul className="space-y-4">
              {athlete.training_sessions.map((session: any, index: number) => (
                <li key={index} className="p-4 bg-gray-50 rounded-lg border">
                  <p className="font-semibold">{format(new Date(session.session_date), 'MMMM d, yyyy h:mm a')}</p>
                  <p>{session.notes}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No training sessions recorded.</p>
          )}
        </div>
      </div>

      {/* Performance Metrics Section */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Performance Metrics</h2>
        {isCoachOrAdmin && (
          <form onSubmit={handleAddMetric} className="mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Metric Name (e.g., 40m Dash)"
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                className="border p-2 rounded"
                disabled={isAddingMetric}
              />
              <input
                type="text"
                placeholder="Metric Value (e.g., 5.2s)"
                value={metricValue}
                onChange={(e) => setMetricValue(e.target.value)}
                className="border p-2 rounded"
                disabled={isAddingMetric}
              />
              <button
                type="submit"
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 relative"
                disabled={isAddingMetric}
              >
                  {isAddingMetric && <span className="absolute inset-0 flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </span>}
                  <span className={isAddingMetric ? 'invisible' : 'visible'}>Add Metric</span>
              </button>
            </div>
            {metricFormError && <p className="text-red-500 text-sm mt-2">{metricFormError}</p>}
          </form>
        )}
        {athlete?.performance_metrics?.length > 0 ? (
          <ul className="space-y-4">
            {athlete.performance_metrics.map((metric: any, index: number) => (
              <li key={index} className="p-4 bg-gray-50 rounded-lg border">
                <p><strong>{metric.metric_name}:</strong> {metric.metric_value}</p>
                <p className="text-sm text-gray-500">
                  {format(new Date(metric.entry_date), 'MMMM d, yyyy')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No performance metrics recorded.</p>
        )}
      </div>
    </div>
  );
};

export default AthleteProfile;
            
