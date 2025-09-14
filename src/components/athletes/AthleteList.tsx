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
    <div className="p-4 bg-white shadow rounded-2xl">
      <h2 className="text-xl font-semibold mb-4">Athletes</h2>
      {athletes.length === 0 ? (
        <p>No athletes found.</p>
      ) : (
        <ul className="space-y-3">
          {athletes.map((athlete) => (
            <li
              key={athlete.id}
              className="flex justify-between items-center p-3 border rounded-xl"
            >
              <span>
                {athlete.firstName} {athlete.lastName}
              </span>
              <div className="space-x-2">
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
