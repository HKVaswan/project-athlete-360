import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { trainingSessionsService } from '../services/trainingSessionsService';

interface TrainingSession {
  session_date: string;
  notes: string;
}

const TrainingSessionsPage = () => {
  const { athleteId } = useParams<{ athleteId: string }>();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        if (athleteId) {
          const fetchedSessions = await trainingSessionsService.getTrainingSessions(athleteId);
          setSessions(fetchedSessions);
        }
      } catch (err) {
        setError('Failed to fetch training sessions.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchSessions();
  }, [athleteId]);

  if (loading) return <div className="text-center mt-8">Loading sessions...</div>;
  if (error) return <div className="text-center mt-8 text-red-500">Error: {error}</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-4xl font-bold text-center mb-6 text-blue-800">Training Sessions</h1>
      <h2 className="text-xl font-semibold text-center mb-4">Athlete ID: {athleteId}</h2>
      <div className="max-w-xl mx-auto">
        {sessions.length > 0 ? (
          <ul className="bg-white shadow-md rounded-lg p-6">
            {sessions.map((session, index) => (
              <li key={index} className="border-b last:border-b-0 py-4">
                <div className="text-gray-500 text-sm">
                  {new Date(session.session_date).toLocaleDateString()}
                </div>
                <p className="mt-2 text-gray-800 whitespace-pre-wrap">{session.notes}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-gray-600">No training sessions found for this athlete.</p>
        )}
      </div>
    </div>
  );
};

export default TrainingSessionsPage;

