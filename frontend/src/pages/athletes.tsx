import { useEffect, useState } from "react";
import { athletesService } from "../services/athletesService";

interface Athlete {
  id: number;
  name: string;
}

const AthletesPage = () => {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAthletes = async () => {
      try {
        const data = await athletesService.getAthletes();
        setAthletes(data);
      } catch (err) {
        setError('Failed to fetch athletes. Please check the backend connection.');
      } finally {
        setLoading(false);
      }
    };

    fetchAthletes();
  }, []);

  if (loading) {
    return <div className="p-4 text-center">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-center text-red-500">{error}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <h1 className="text-4xl font-bold mb-8">Athlete Management</h1>
      <ul className="list-disc pl-5">
        {athletes.map(athlete => (
          <li key={athlete.id} className="text-lg">
            {athlete.name}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AthletesPage;
