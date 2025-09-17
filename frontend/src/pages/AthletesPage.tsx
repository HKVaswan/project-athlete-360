import { useState, useEffect } from 'react';
import { athletesService } from '../services/athletesService';

interface Athlete {
  id: number;
  name: string;
}

const AthletesPage = () => {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

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

  const handleUpdate = async (id: number) => {
    try {
      await athletesService.updateAthlete(id, editingName);
      setEditingId(null);
      setEditingName('');
      fetchAthletes(); // Refresh the list
    } catch (err) {
      setError('Failed to update athlete.');
      console.error(err);
    }
  };

  const handleEditClick = (athlete: Athlete) => {
    setEditingId(athlete.id);
    setEditingName(athlete.name);
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
                  // Edit mode
                  <div className="flex-grow flex items-center">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="shadow appearance-none border rounded w-full py-1 px-2 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                    <button
                      onClick={() => handleUpdate(athlete.id)}
                      className="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded ml-2 focus:outline-none focus:shadow-outline"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded ml-2 focus:outline-none focus:shadow-outline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  // View mode
                  <>
                    <span className="text-lg">{athlete.name}</span>
                    <div className="flex space-x-2">
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
                    </div>
                  </>
                )}
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

