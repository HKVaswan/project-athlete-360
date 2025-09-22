// src/components/injuries/InjuryList.tsx
import React from "react";
import { Injury } from "../../types/injury";

interface InjuryListProps {
  injuries: Injury[];
  onDelete: (id: string) => void;
  onEdit: (injury: Injury) => void;
}

const InjuryList: React.FC<InjuryListProps> = ({ injuries, onDelete, onEdit }) => {
  if (injuries.length === 0) {
    return <p className="text-gray-500">No injuries found for this athlete.</p>;
  }

  return (
    <div className="p-4 border rounded-2xl shadow-md bg-white">
      <ul className="divide-y divide-gray-200">
        {injuries.map((injury) => (
          <li
            key={injury.id}
            className="py-4 flex justify-between items-center"
          >
            <div>
              <p className="font-semibold text-gray-800">{injury.description}</p>
              <p className="text-sm text-gray-500">
                {injury.date} | Severity: {injury.severity}
              </p>
            </div>
            <div className="space-x-2 flex-shrink-0">
              <button
                onClick={() => onEdit(injury)}
                className="text-sm px-3 py-1 rounded-lg text-blue-600 hover:bg-blue-50 transition"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(injury.id)}
                className="text-sm px-3 py-1 rounded-lg text-red-600 hover:bg-red-50 transition"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default InjuryList;