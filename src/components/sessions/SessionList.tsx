// src/components/sessions/SessionList.tsx

import React from "react";
import { Link } from "react-router-dom";
import { Session } from "../../types/session";

interface SessionListProps {
  sessions: Session[];
  onEdit: (session: Session) => void;
  onDelete: (id: string) => void;
}

const SessionList: React.FC<SessionListProps> = ({ sessions, onEdit, onDelete }) => {
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-gray-500">No sessions found.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="p-4 border rounded flex justify-between items-center"
            >
              <div>
                <p className="font-semibold">{session.name}</p>
                <p className="text-sm text-gray-500">{session.date}</p>
              </div>
              <div className="space-x-2">
                <button
                  onClick={() => onEdit(session)}
                  className="bg-yellow-500 text-white px-2 py-1 rounded"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(session.id)}
                  className="bg-red-500 text-white px-2 py-1 rounded"
                >
                  Delete
                </button>
                <Link
                  to={`/attendance/${session.id}`}
                  className="bg-blue-600 text-white px-2 py-1 rounded"
                >
                  View Attendance
                </Link>
                <Link
                  to={`/assessments?sessionId=${session.id}`}
                  className="bg-purple-600 text-white px-2 py-1 rounded"
                >
                  View Assessments
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SessionList;
