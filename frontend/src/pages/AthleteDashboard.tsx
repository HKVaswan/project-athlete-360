import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL;

const AthleteDashboard: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [athlete, setAthlete] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAthleteProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) {
        throw new Error("User not authenticated.");
      }

      // Find the athlete ID associated with the logged-in user
      const athleteResponse = await fetch(`${API_URL}/api/athletes?userId=${user.userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!athleteResponse.ok) {
        throw new Error("Failed to find your athlete profile.");
      }

      const athleteData = await athleteResponse.json();
      if (!athleteData.success || athleteData.data.length === 0) {
        throw new Error("No athlete profile found for this user.");
      }
      const athleteId = athleteData.data[0].id;
      
      // Fetch the full profile with sessions and metrics using the athlete ID
      const profileResponse = await fetch(`${API_URL}/api/athletes/${athleteId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (profileResponse.status === 401) {
        logout();
        return;
      }

      if (!profileResponse.ok) {
        const errData = await profileResponse.json();
        throw new Error(errData.message || 'Failed to fetch profile data.');
      }

      const { data } = await profileResponse.json();
      setAthlete(data);

    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching your dashboard.');
    } finally {
      setLoading(false);
    }
  }, [user, token, logout]);

  useEffect(() => {
    if (user) {
      fetchAthleteProfile();
    }
  }, [fetchAthleteProfile, user]);

  if (loading) return <div className="p-4">Loading your dashboard...</div>;
  if (error) return (
    <div className="p-4 text-red-500">
      {error}
      <button onClick={fetchAthleteProfile} className="ml-2 underline text-blue-600">
        Retry
      </button>
    </div>
  );
  if (!athlete) return <div className="p-4">No athlete profile found.</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Welcome, {athlete?.name}!</h1>
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
        
        {/* Training Sessions List */}
        <div className="bg-white p-6 rounded-lg shadow-md md:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Training Sessions</h2>
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

export default AthleteDashboard;
 
