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

  useEffect(() => {
    if (athleteId) {
      injuriesService.getByAthlete(athleteId).then(setInjuries);
    }
  }, [athleteId]);

  const handleCreate = async (payload: InjuryPayload) => {
    const newInjury = await injuriesService.create(payload);
    setInjuries((prev) => [...prev, newInjury]);
  };

  const handleUpdate = async (payload: InjuryPayload) => {
    if (!editing) return;
    const updated = await injuriesService.update(editing.id, payload);
    setInjuries((prev) =>
      prev.map((inj) => (inj.id === editing.id ? updated : inj))
    );
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await injuriesService.delete(id);
    setInjuries((prev) => prev.filter((inj) => inj.id !== id));
  };

  return (
    <div className="p-4 space-y-4">
      <button
        onClick={() => navigate("/athletes")}
        className="text-blue-500 hover:underline"
      >
        ← Back to Athletes
      </button>

      <h1 className="text-xl font-bold">Injuries</h1>

      <InjuryForm
        athleteId={athleteId || ""}
        onSubmit={editing ? handleUpdate : handleCreate}
        initialData={editing || undefined}
      />

      <InjuryList
        injuries={injuries}
        onDelete={handleDelete}
        onEdit={setEditing}
      />
    </div>
  );
};

export default InjuriesPage;
