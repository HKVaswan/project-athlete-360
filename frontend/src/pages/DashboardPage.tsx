import { useState, useEffect } from 'react';
import { athletesService } from '../services/athletesService';

const DashboardPage = () => {
  const [totalAthletes, setTotalAthletes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTotalAthletes = async () => {
      try {
        const athletes = await athletesService.getAthletes();
        setTotalAthletes(athletes.length);
      } catch (error) {
        console.error("Failed to fetch athletes for dashboard:", error);
        setTotalAthletes(0); // Default to 0 on error
      } finally {
        setLoading(false);
      }
    };

    fetchTotalAthletes();
  }, []);

  return (
    <div className="container mx-auto p-4 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-8 text-center text-blue-800">Welcome to Your Dashboard</h1>
      
      {loading ? (
        <p>Loading data...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-4xl">
          {/* Card to display total athletes */}
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <h2 className="text-2xl font-semibold text-gray-700">Total Athletes</h2>
            <p className="mt-2 text-5xl font-bold text-blue-600">
              {totalAthletes}
            </p>
          </div>
          
          {/* You can add more impressive cards here later */}
          {/* Example:
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <h2 className="text-2xl font-semibold text-gray-700">Recent Activity</h2>
            <p className="mt-2 text-gray-500">No new activity</p>
          </div>
          */}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
