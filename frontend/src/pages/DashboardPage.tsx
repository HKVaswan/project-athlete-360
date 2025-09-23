// src/pages/DashboardPage.tsx

import React, { useState, useEffect } from "react";
import { athletesService } from "../services/athletesService";
import { FaUsers, FaSync } from "react-icons/fa";

const DashboardPage: React.FC = () => {
  const [totalAthletes, setTotalAthletes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchTotalAthletes = async () => {
    setLoading(true);
    setError("");
    try {
      const athletes = await athletesService.getAthletes();
      setTotalAthletes(athletes.length);
    } catch (err) {
      console.error("Failed to fetch athletes for dashboard:", err);
      setError("Failed to load data. Please try again.");
      setTotalAthletes(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTotalAthletes();
  }, []);

  return (
    <div className="container mx-auto p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-8 text-center text-blue-800 dark:text-blue-400">
        Welcome to Your Dashboard
      </h1>

      {loading ? (
        <div className="flex items-center space-x-3 text-blue-600 dark:text-blue-400">
          <FaSync className="animate-spin" />
          <span>Loading data...</span>
        </div>
      ) : error ? (
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchTotalAthletes}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-5xl">
          {/* Total Athletes Card */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg text-center transform transition hover:scale-105">
            <div className="flex justify-center items-center mb-3">
              <FaUsers className="text-blue-600 dark:text-blue-400 text-4xl" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">
              Total Athletes
            </h2>
            <p className="mt-2 text-5xl font-extrabold text-blue-600 dark:text-blue-400">
              {totalAthletes}
            </p>
          </div>

          {/* Placeholder: Add more cards in future */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg text-center">
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">
              Recent Activity
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Coming soon...
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg text-center">
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">
              Upcoming Sessions
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Feature in progress
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;