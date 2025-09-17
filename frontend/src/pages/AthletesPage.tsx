import { useState, useEffect } from 'react';
import { athletesService } from '../services/athletesService';

const AthletesPage = () => {
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      // After successful deletion, refresh the list of athletes
      fetchAthletes();
    } catch (err) {
      setError('Failed to delete athlete.');
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
                <span className="text-lg">{athlete.name}</span>
                <button
                  onClick={() => handleDelete(athlete.id)}
                  className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded focus:outline-none focus:shadow-outline"
                >
                  Delete
                </button>
              </li>
            ))
          ) : (
            <p>No athletes found. Please create one.</p>
          )}
        </ul>
      </div>
    </div>
  );
};

export default AthletesPage;
