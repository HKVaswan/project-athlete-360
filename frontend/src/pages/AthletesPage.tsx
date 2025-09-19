import { useState, useEffect } from 'react';
import { athletesService } from '../services/athletesService';
import { trainingSessionsService } from '../services/trainingSessionsService';

interface Athlete {
  id: number;
  name: string;
  athlete_id: string;
}

const AthletesPage = () => {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingAthleteId, setEditingAthleteId] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [loggingSessionId, setLoggingSessionId] = useState<number | null>(null);

  const fetchAthletes = async () => {
    try {
      const fetchedAthletes = await athletesService.getAthletes();
      setAthletes(fetchedAthletes);
    } catch (err) {
      setError('Failed to fetch athletes.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAthletes();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await athletesService.deleteAthlete(id);
      fetchAthletes();
    } catch (err) {
      setError('Failed to delete athlete.');
      console.error(err);
    }
  };

  const handleUpdate = async (id: number) => {
    try {
      await athletesService.updateAthlete(id, editingName, editingAthleteId);
      setEditingId(null);
      setEditingName('');
      setEditingAthleteId('');
      fetchAthletes();
    } catch (err) {
      setError('Failed to update athlete.');
      console.error(err);
    }
  };

  const handleEditClick = (athlete: Athlete) => {
    setEditingId(athlete.id);
    setEditingName(athlete.name);
    setEditingAthleteId(athlete.athlete_id);
  };

  const handleLogSession = async (athleteId: number) => {
    try {
      await trainingSessionsService.createTrainingSession(athleteId, sessionNotes);
      setLoggingSessionId(null);
      setSessionNotes('');
      alert('Session logged successfully!');
    } catch (err) {
      alert('Failed to log session.');
      console.error(err);
    }
  };

  if (loading) return <div className="text-center mt-8">Loading...</div>;
  if (error) return <div className="text-center mt-8 text-red-500">Error: {error}</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-4xl font-bold text-center mb-6 text-blue-800">Athlete Management</h1>
      <div className="max-w-xl mx-auto">
        <h2 className="text-2xl font-semibold mb-4">List of Athletes</h2>
        <ul className="bg-white shadow-md rounded-lg p-6">
          {athletes.length > 0 ? (
            athletes.map((athlete: any) => (
              <li key={athlete.id} className="flex justify-between items-center py-2 border-b last:border-b-0">
                {editingId === athlete.id ? (
                  <div className="flex-grow flex flex-col sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={editingAthleteId}
                      onChange={(e) => setEditingAthleteId(e.target.value)}
                      className="shadow appearance-none border rounded w-full py-1 px-2 mb-2 sm:mb-0 sm:mr-2 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="shadow appearance-none border rounded w-full py-1 px-2 mb-2 sm:mb-0 sm:mr-2 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleUpdate(athlete.id)}
                        className="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center">
                      <span className="text-lg font-bold mr-2">{athlete.athlete_id}</span>
                      <span className="text-lg">{athlete.name}</span>
                    </div>
                    <div className="flex space-x-2 ml-auto">
                      <button
                        onClick={() => handleEditClick(athlete)}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(athlete.id)}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setLoggingSessionId(athlete.id)}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                      >
                        Log Session
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))
          ) : (
            <p>No athletes found. Please create one.</p>
          )}
        </ul>

        {loggingSessionId && (
          <div className="mt-8 p-6 bg-white rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-4">Log a Session for Athlete ID: {athletes.find(a => a.id === loggingSessionId)?.athlete_id}</h3>
            <textarea
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              rows={4}
              placeholder="Enter session notes here..."
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
            ></textarea>
            <div className="flex justify-end space-x-2 mt-4">
              <button
                onClick={() => handleLogSession(loggingSessionId)}
                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Submit
              </button>
              <button
                onClick={() => setLoggingSessionId(null)}
                className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AthletesPage;
