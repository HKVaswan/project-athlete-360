// src/components/assessments/AssessmentForm.tsx

import React, { useState } from "react";
import { CreateAssessmentInput, Assessment } from "../../types/assessment";

interface Props {
  initialData?: Assessment;
  onSubmit: (data: CreateAssessmentInput) => void;
  onCancel: () => void;
}

const AssessmentForm: React.FC<Props> = ({ initialData, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState<CreateAssessmentInput>({
    athlete_id: initialData?.athlete_id || "",
    session_id: initialData?.session_id || "",
    metric: initialData?.metric || "",
    value: initialData?.value || "",
    notes: initialData?.notes || "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-xl shadow-md">
      <input
        name="athlete_id"
        placeholder="Athlete ID"
        value={formData.athlete_id}
        onChange={handleChange}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2"
        required
      />
      <input
        name="session_id"
        placeholder="Session ID"
        value={formData.session_id}
        onChange={handleChange}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2"
        required
      />
      <input
        name="metric"
        placeholder="Metric (e.g. Speed, Endurance)"
        value={formData.metric}
        onChange={handleChange}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2"
        required
      />
      <input
        name="value"
        placeholder="Value (e.g. 7.5s, 20 reps)"
        value={formData.value}
        onChange={handleChange}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2"
        required
      />
      <input
        name="notes"
        placeholder="Notes (optional)"
        value={formData.notes}
        onChange={handleChange}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2"
      />

      <div className="flex gap-2">
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md">
          {initialData ? "Update" : "Create"} Assessment
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default AssessmentForm;
