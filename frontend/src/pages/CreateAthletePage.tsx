// src/pages/CreateAthletePage.tsx

import React, { useState } from "react";
import { athletesService } from "../services/athletesService";
import { FaSpinner } from "react-icons/fa";

const CreateAthletePage: React.FC = () => {
  const [name, setName] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("");
    setSuccess(false);

    try {
      await athletesService.createAthlete(name, athleteId);
      setStatus(`Successfully created athlete: ${name}`);
      setSuccess(true);
      setName("");
      setAthleteId("");
    } catch (error) {
      console.error(error);
      setStatus("Error creating athlete. Please try again.");
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-6 bg-gray-100 dark:bg-gray-900">
      <h1 className="text-3xl font-bold mb-8 text-center text-blue-800 dark:text-blue-400">
        Create New Athlete
      </h1>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md"
      >
        {/* Athlete ID */}
        <div className="mb-4">
          <label
            htmlFor="athleteId"
            className="block text-gray-700 dark:text-gray-300 font-medium mb-2"
          >
            Athlete ID
          </label>
          <input
            type="text"
            id="athleteId"
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
            className="w-full px-3 py-2 border rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {/* Athlete Name */}
        <div className="mb-4">
          <label
            htmlFor="athleteName"
            className="block text-gray-700 dark:text-gray-300 font-medium mb-2"
          >
            Athlete's Full Name
          </label>
          <input
            type="text"
            id="athleteName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-between">
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded flex items-center justify-center disabled:opacity-50"
          >
            {loading && <FaSpinner className="animate-spin mr-2" />}
            Create Athlete
          </button>
        </div>

        {/* Status Message */}
        {status && (
          <p
            className={`mt-4 text-center ${
              success
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {status}
          </p>
        )}
      </form>
    </div>
  );
};

export default CreateAthletePage;