import { useState } from 'react';
import { athletesService } from '../services/athletesService';

const CreateAthletePage = () => {
  const [name, setName] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Creating athlete...');
    try {
      await athletesService.createAthlete(name, athleteId);
      setStatus(`Successfully created athlete: ${name}`);
      setName(''); // Clear the input field
      setAthleteId('');
    } catch (error) {
      setStatus('Error creating athlete.');
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-100">
      <h1 className="text-4xl font-bold mb-8 text-center text-blue-800">Create New Athlete</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <div className="mb-4">
          <label htmlFor="athleteId" className="block text-gray-700 font-bold mb-2">
            Athlete ID
          </label>
          <input
            type="text"
            id="athleteId"
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            required
          />
        </div>
        <div className="mb-4">
          <label htmlFor="athleteName" className="block text-gray-700 font-bold mb-2">
            Athlete's Full Name
          </label>
          <input
            type="text"
            id="athleteName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            required
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Create Athlete
          </button>
        </div>
        {status && <p className="mt-4 text-center text-gray-600">{status}</p>}
      </form>
    </div>
  );
};

export default CreateAthletePage;
