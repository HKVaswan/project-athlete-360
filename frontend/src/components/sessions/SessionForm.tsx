// src/components/sessions/SessionForm.tsx
import React, { useState } from "react";
import { Session, SessionPayload } from "../../types/session";

interface Props {
  initialData?: Session;
  onSubmit: (payload: SessionPayload) => void;
  onCancel: () => void;
}

const SessionForm: React.FC<Props> = ({ initialData, onSubmit, onCancel }) => {
  const [name, setName] = useState(initialData?.name || "");
  const [date, setDate] = useState(initialData?.date || "");
  const [location, setLocation] = useState(initialData?.location || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, date, location });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-2xl shadow-md bg-white">
      <div>
        <label className="block text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"
          placeholder="Session Name"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"
          placeholder="Venue or Facility"
          required
        />
      </div>

      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 rounded-md border border-gray-300 hover:bg-gray-100 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition"
        >
          {initialData ? "Update Session" : "Create Session"}
        </button>
      </div>
    </form>
  );
};

export default SessionForm;