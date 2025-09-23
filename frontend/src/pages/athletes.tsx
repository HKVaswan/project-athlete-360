// src/pages/athletes.tsx

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { athletesService } from "../services/athletesService";

interface Athlete {
  id: number;
  name: string;
  sport?: string;
  dob?: string;
}

const AthletesPage: React.FC = () => {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAthletes = async () => {
      try {
        const data = await athletesService.getAthletes();
        setAthletes(data);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch athletes. Please check the backend connection.");
      } finally {
        setLoading(false);
      }
    };

    fetchAthletes();
  }, []);

  if (loading) return <div className="p-4 text-center">Loading athletes...</div>;
  if (error) return <div className="p-4 text-center text-red-500">{error}</div>;

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <h1 className="text-4xl font-bold mb-8 text-center">Athlete Management</h1>

      {athletes.length === 0 ? (
        <p className="text-gray-600">No athletes found.</p>
      ) : (
        <ul className="w-full max-w-2xl space-y-3">
          {athletes.map((athlete) => (
            <li
              key={athlete.id}
              className="p-4 border rounded-lg shadow hover:shadow-md cursor-pointer transition"
              onClick={() => navigate(`/athlete/${athlete.id}`)}
            >
              <h2 className="text-xl font-semibold">{athlete.name}</h2>
              {athlete.sport && <p className="text-gray-500">Sport: {athlete.sport}</p>}
              {athlete.dob && <p className="text-gray-500">DOB: {new Date(athlete.dob).toLocaleDateString()}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AthletesPage;