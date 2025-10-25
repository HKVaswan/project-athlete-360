// src/pages/AthleteDashboard.tsx
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { format } from "date-fns";
import { FaSpinner } from "react-icons/fa";

const API_URL = (import.meta.env.VITE_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

interface TrainingSession {
  session_date: string;
  notes: string;
}

interface PerformanceMetric {
  metric_name: string;
  metric_value: string | number;
  entry_date: string;
}

interface Athlete {
  id: string;
  name: string;
  sport?: string | null;
  dob?: string | null;
  gender?: string | null;
  contactInfo?: string | null; // backend uses camelCase
  training_sessions: TrainingSession[];
  performance_metrics: PerformanceMetric[];
}

const AthleteDashboard: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAthleteProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!user) throw new Error("User not authenticated.");

      // Note: use /api/athletes?userId=<uuid>
      const athleteRes = await fetch(`${API_URL}/api/athletes?userId=${encodeURIComponent(user.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!athleteRes.ok) {
        // give more context to client
        const errBody = await athleteRes.json().catch(() => ({}));
        throw new Error(errBody.message || "Failed to find your athlete profile.");
      }

      const athleteData = await athleteRes.json();
      const arr = athleteData.data || athleteData; // be tolerant

      if (!arr || arr.length === 0) throw new Error("No athlete profile found for this user.");

      const raw = arr[0];

      // Fetch full profile (optional) but backend /api/athletes/:id returns fields under "data"
      const profileRes = await fetch(`${API_URL}/api/athletes/${raw.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (profileRes.status === 401) {
        logout();
        return;
      }

      if (!profileRes.ok) {
        const errData = await profileRes.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to fetch profile data.");
      }

      const profileBody = await profileRes.json();
      const profileRaw = profileBody.data || profileBody.user || profileBody; // tolerant

      // Normalize to frontend shape
      const normalized: Athlete = {
        id: String(profileRaw.id),
        name: profileRaw.name,
        sport: profileRaw.sport,
        dob: profileRaw.dob,
        gender: profileRaw.gender,
        contactInfo: profileRaw.contactInfo ?? profileRaw.contact_info ?? profileRaw.contact, // be tolerant
        training_sessions: profileRaw.sessions || profileRaw.training_sessions || [],
        performance_metrics: profileRaw.performances || profileRaw.performance_metrics || [],
      };

      setAthlete(normalized);
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [user, token, logout]);

  useEffect(() => {
    if (user) fetchAthleteProfile();
  }, [fetchAthleteProfile, user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-blue-500">
        <FaSpinner className="animate-spin mr-2 text-2xl" />
        Loading your dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-500 text-center">
        {error}
        <button onClick={fetchAthleteProfile} className="ml-2 underline text-blue-600">
          Retry
        </button>
      </div>
    );
  }

  if (!athlete) {
    return <div className="p-4 text-gray-500 text-center">No athlete profile found.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Welcome, {athlete.name}!</h1>

      {/* Personal Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md md:col-span-1">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Personal Details</h2>
          <p>
            <strong>Sport:</strong> {athlete.sport || "Not provided"}
          </p>
          <p>
            <strong>Date of Birth:</strong>{" "}
            {athlete.dob ? format(new Date(athlete.dob), "MMMM d, yyyy") : "Not provided"}
          </p>
          <p>
            <strong>Gender:</strong> {athlete.gender || "Not provided"}
          </p>
          <p>
            <strong>Contact Info:</strong> {athlete.contactInfo || "Not provided"}
          </p>
        </div>

        {/* Training Sessions */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md md:col-span-2">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Training Sessions</h2>
          {athlete.training_sessions.length > 0 ? (
            <ul className="space-y-4">
              {athlete.training_sessions.map((session, idx) => (
                <li key={idx} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border">
                  <p className="font-semibold">
                    {format(new Date(session.session_date || session.date || Date.now()), "MMMM d, yyyy h:mm a")}
                  </p>
                  <p>{session.notes || session.description || "No notes"}</p>
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
            {athlete.performance_metrics.map((metric, idx) => (
              <li key={idx} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border">
                <p>
                  <strong>{metric.metric_name || metric.metric || "Metric"}:</strong> {metric.metric_value}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {format(new Date(metric.entry_date || metric.date || Date.now()), "MMMM d, yyyy")}
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

export default AthleteDashboard;