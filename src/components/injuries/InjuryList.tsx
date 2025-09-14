// src/components/injuries/InjuryList.tsx

import React from "react";
import { Injury } from "../../types/injury";

interface Props {
  injuries: Injury[];
  onDelete: (id: string) => void;
  onEdit: (injury: Injury) => void;
}

const InjuryList: React.FC<Props> = ({ injuries, onDelete, onEdit }) => {
  if (injuries.length === 0) {
    return <p className="text-gray-500">No injuries found for this athlete.</p>;
  }

  return (
    <div className="p-4 border rounded-md shadow-md">
      <ul className="divide-y divide-gray-200">
        {injuries.map((injury) => (
          <li
            key={injury.id}
            className="py-4 flex justify-between items-center"
          >
            <div>
              <p className="font-semibold">{injury.description}</p>
              <p className="text-sm text-gray-500">
                {injury.date} | Severity: {injury.severity}
              </p>
            </div>
            <div className="space-x-2">
              <button
                onClick={() => onEdit(injury)}
                className="text-sm px-2 py-1 rounded text-blue-500 hover:bg-gray-100"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(injury.id)}
                className="text-sm px-2 py-1 rounded text-red-500 hover:bg-gray-100"
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
