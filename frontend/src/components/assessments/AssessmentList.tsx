// src/components/assessments/AssessmentList.tsx

import React from "react";
import { Assessment } from "../../types/assessment";

interface Props {
  assessments: Assessment[];
  onEdit: (assessment: Assessment) => void;
  onDelete: (id: string) => void;
}

const AssessmentList: React.FC<Props> = ({ assessments, onEdit, onDelete }) => {
  if (assessments.length === 0) {
    return <p className="text-gray-500">No assessments found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse border">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">Athlete ID</th>
            <th className="border p-2 text-left">Session ID</th>
            <th className="border p-2 text-left">Metric</th>
            <th className="border p-2 text-left">Value</th>
            <th className="border p-2 text-left">Notes</th>
            <th className="border p-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <td className="border p-2">{a.athlete_id}</td>
              <td className="border p-2">{a.session_id}</td>
              <td className="border p-2">{a.metric}</td>
              <td className="border p-2">{a.value}</td>
              <td className="border p-2">{a.notes || "-"}</td>
              <td className="border p-2 flex gap-2">
                <button
                  onClick={() => onEdit(a)}
                  className="bg-yellow-500 text-white px-2 py-1 rounded text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(a.id)}
                  className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AssessmentList;
