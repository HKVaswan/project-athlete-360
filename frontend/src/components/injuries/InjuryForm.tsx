// src/components/injuries/InjuryForm.tsx
import React, { useState } from "react";
import { Injury, InjuryPayload } from "../../types/injury";

interface InjuryFormProps {
  athleteId: string;
  onSubmit: (payload: InjuryPayload) => void;
  initialData?: Injury;
}

const InjuryForm: React.FC<InjuryFormProps> = ({ athleteId, onSubmit, initialData }) => {
  const [description, setDescription] = useState(initialData?.description || "");
  const [date, setDate] = useState(initialData?.date || "");
  const [severity, setSeverity] = useState<"minor" | "moderate" | "severe">(
    initialData?.severity || "minor"
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ athleteId, description, date, severity });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-2xl shadow-md bg-white">
      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Severity</label>
        <select
          value={severity}
          onChange={(e) =>
            setSeverity(e.target.value as "minor" | "moderate" | "severe")
          }
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="minor">Minor</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </select>
      </div>

      <div className="flex justify-end space-x-2">
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition"
        >
          {initialData ? "Update Injury" : "Add Injury"}
        </button>
      </div>
    </form>
  );
};

export default InjuryForm;