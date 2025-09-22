// src/components/athletes/AthleteList.tsx
import React from "react";
import { Athlete } from "../../types/athlete";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface Props {
  athletes: Athlete[];
  onEdit: (athlete: Athlete) => void;
  onDelete: (athleteId: string) => void;
}

const AthleteList: React.FC<Props> = ({ athletes, onEdit, onDelete }) => {
  const navigate = useNavigate();

  return (
    <div className="p-4 bg-white dark:bg-gray-800 shadow rounded-2xl">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-100">Athletes</h2>
      {athletes.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No athletes found.</p>
      ) : (
        <ul className="space-y-3">
          {athletes.map((athlete) => (
            <li
              key={athlete.id}
              className="flex justify-between items-center p-3 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <span className="text-gray-700 dark:text-gray-200">
                {athlete.firstName || ""} {athlete.lastName || ""}
              </span>
              <div className="space-x-2 flex-shrink-0">
                <Button onClick={() => onEdit(athlete)} size="sm">
                  Edit
                </Button>
                <Button
                  onClick={() => onDelete(athlete.id)}
                  variant="destructive"
                  size="sm"
                >
                  Delete
                </Button>
                <Button
                  onClick={() => navigate(`/athletes/${athlete.id}/performance`)}
                  variant="outline"
                  size="sm"
                >
                  View Performance
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AthleteList;