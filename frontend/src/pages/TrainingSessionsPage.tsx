import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trainingSessionsService } from '../services/trainingSessionsService';

interface TrainingSession {
  session_date: string;
  notes: string;
}

const TrainingSessionsPage: React.FC = () => {
  const { athleteId } = useParams<{ athleteId: string }>();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        if (athleteId) {
          const fetchedSessions = await trainingSessionsService.getTrainingSessions(athleteId);
          setSessions(fetchedSessions);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to fetch training sessions.');
      } finally {
        setLoading(false);
      }
    };
    fetchSessions();
  }, [athleteId]);

  if (loading) {
    return <div className="text-center mt-12 text-gray-600 dark:text-gray-300">Loading sessions...</div>;
  }

  if (error) {
    return <div className="text-center mt-12 text-red-500">{error}</div>;
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-gray-900">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 px-4 py-2 rounded-md bg-blue-100 dark:bg-gray-700 text-blue-700 dark:text-gray-200 hover:bg-blue-200 dark:hover:bg-gray-600"
      >
        ← Back
      </button>

      <h1 className="text-4xl font-bold text-center mb-2 text-gray-800 dark:text-gray-100">Training Sessions</h1>
      <h2 className="text-xl text-center mb-6 text-gray-600 dark:text-gray-300">
        Athlete ID: {athleteId}
      </h2>

      <div className="max-w-xl mx-auto">
        {sessions.length > 0 ? (
          <ul className="bg-white dark:bg-gray-800 shadow-md rounded-lg divide-y divide-gray-200 dark:divide-gray-700 p-4">
            {sessions.map((session, index) => (
              <li key={index} className="py-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(session.session_date).toLocaleDateString()}
                </div>
                <p className="mt-1 text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{session.notes}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-gray-600 dark:text-gray-400">
            No training sessions found for this athlete.
          </p>
        )}
      </div>
    </div>
  );
};

export default TrainingSessionsPage;