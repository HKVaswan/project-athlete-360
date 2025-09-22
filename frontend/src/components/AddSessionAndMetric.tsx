// src/components/AddSessionAndMetric.tsx
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FaPlusCircle, FaExclamationCircle } from 'react-icons/fa';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL;

interface AddSessionAndMetricProps {
  athleteId: number;
  onDataAdded: () => void;
}

const AddSessionAndMetric: React.FC<AddSessionAndMetricProps> = ({ athleteId, onDataAdded }) => {
  const { token } = useAuth();

  // Success message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Session state
  const [sessionDate, setSessionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sessionNotes, setSessionNotes] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Metric state
  const [metricName, setMetricName] = useState('');
  const [metricValue, setMetricValue] = useState<number | ''>('');
  const [metricUnit, setMetricUnit] = useState('');
  const [metricNotes, setMetricNotes] = useState('');
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setSessionLoading(true);
    setSessionError(null);

    try {
      const res = await fetch(`${API_URL}/api/training-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          athlete_id: athleteId,
          session_date: sessionDate,
          notes: sessionNotes,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to add training session');

      setSessionDate(format(new Date(), 'yyyy-MM-dd'));
      setSessionNotes('');
      onDataAdded();
      showSuccess('Training session added successfully!');
    } catch (err: any) {
      setSessionError(err?.message || 'Unexpected error occurred.');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleAddMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    setMetricLoading(true);
    setMetricError(null);

    try {
      if (metricValue === '' || isNaN(Number(metricValue))) {
        throw new Error('Metric value must be a valid number.');
      }

      const res = await fetch(`${API_URL}/api/performance-metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          athlete_id: athleteId,
          metric_name: metricName,
          metric_value: `${metricValue} ${metricUnit}`.trim(),
          notes: metricNotes,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to add performance metric');

      setMetricName('');
      setMetricValue('');
      setMetricUnit('');
      setMetricNotes('');
      onDataAdded();
      showSuccess('Performance metric added successfully!');
    } catch (err: any) {
      setMetricError(err?.message || 'Unexpected error occurred.');
    } finally {
      setMetricLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded" role="alert">
          {successMessage}
        </div>
      )}

      {/* Training Session Form */}
      <div className="bg-white p-6 rounded-2xl shadow-md">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <FaPlusCircle className="text-blue-500" /> Add New Training Session
        </h2>
        <form onSubmit={handleAddSession} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Session Date</label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              disabled={sessionLoading}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Notes</label>
            <textarea
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              rows={3}
              maxLength={500}
              required
            />
          </div>
          {sessionError && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <FaExclamationCircle /> {sessionError}
            </div>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
            disabled={sessionLoading}
          >
            <FaPlusCircle /> {sessionLoading ? 'Adding...' : 'Add Session'}
          </button>
        </form>
      </div>

      {/* Performance Metric Form */}
      <div className="bg-white p-6 rounded-2xl shadow-md">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <FaPlusCircle className="text-blue-500" /> Add New Performance Metric
        </h2>
        <form onSubmit={handleAddMetric} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Metric Name</label>
            <input
              type="text"
              value={metricName}
              onChange={(e) => setMetricName(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Metric Value</label>
            <input
              type="number"
              step="any"
              value={metricValue}
              onChange={(e) => setMetricValue(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Unit (optional)</label>
            <input
              type="text"
              value={metricUnit}
              onChange={(e) => setMetricUnit(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Notes (optional)</label>
            <textarea
              value={metricNotes}
              onChange={(e) => setMetricNotes(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              rows={2}
              maxLength={200}
            />
          </div>
          {metricError && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <FaExclamationCircle /> {metricError}
            </div>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
            disabled={metricLoading}
          >
            <FaPlusCircle /> {metricLoading ? 'Adding...' : 'Add Metric'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AddSessionAndMetric;