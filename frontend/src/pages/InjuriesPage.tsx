// src/pages/InjuriesPage.tsx

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { injuriesService } from "../services/injuriesService";
import { Injury, InjuryPayload } from "../types/injury";
import InjuryForm from "../components/injuries/InjuryForm";
import InjuryList from "../components/injuries/InjuryList";

const InjuriesPage: React.FC = () => {
  const { athleteId } = useParams<{ athleteId: string }>();
  const navigate = useNavigate();

  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [editing, setEditing] = useState<Injury | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch injuries for this athlete
  useEffect(() => {
    if (!athleteId) return;

    const fetchInjuries = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await injuriesService.getByAthlete(athleteId);
        setInjuries(data);
      } catch (err: any) {
        setError("Failed to load injuries. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchInjuries();
  }, [athleteId]);

  // Create new injury
  const handleCreate = async (payload: InjuryPayload) => {
    try {
      const newInjury = await injuriesService.create(payload);
      setInjuries((prev) => [...prev, newInjury]);
    } catch {
      setError("Failed to create injury record.");
    }
  };

  // Update existing injury
  const handleUpdate = async (payload: InjuryPayload) => {
    if (!editing) return;
    try {
      const updated = await injuriesService.update(editing.id, payload);
      setInjuries((prev) =>
        prev.map((inj) => (inj.id === editing.id ? updated : inj))
      );
      setEditing(null);
    } catch {
      setError("Failed to update injury record.");
    }
  };

  // Delete injury
  const handleDelete = async (id: string) => {
    try {
      await injuriesService.delete(id);
      setInjuries((prev) => prev.filter((inj) => inj.id !== id));
    } catch {
      setError("Failed to delete injury.");
    }
  };

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Back button */}
        <button
          onClick={() => navigate("/athletes")}
          className="text-blue-600 hover:underline text-sm"
        >
          ← Back to Athletes
        </button>

        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-800">Injuries</h1>
        <p className="text-gray-600">
          Manage and track injuries for this athlete.
        </p>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-100 border border-red-300 rounded text-red-700">
            {error}
          </div>
        )}

        {/* Injury Form */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">
            {editing ? "Edit Injury" : "Add New Injury"}
          </h2>
          <InjuryForm
            athleteId={athleteId || ""}
            onSubmit={editing ? handleUpdate : handleCreate}
            initialData={editing || undefined}
          />
        </div>

        {/* Injury List */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Injury Records</h2>
          {loading ? (
            <p className="text-gray-500">Loading injuries...</p>
          ) : injuries.length > 0 ? (
            <InjuryList
              injuries={injuries}
              onDelete={handleDelete}
              onEdit={setEditing}
            />
          ) : (
            <p className="text-gray-500">No injuries found for this athlete.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default InjuriesPage;