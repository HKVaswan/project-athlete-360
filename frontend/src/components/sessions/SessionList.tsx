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
  if (sessions.length === 0) {
    return <p className="text-gray-500 p-4">No sessions found.</p>;
  }

  return (
    <div className="p-4 bg-white shadow rounded-2xl">
      <h2 className="text-xl font-semibold mb-4">Sessions</h2>
      <ul className="space-y-3">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="p-4 border rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center hover:bg-gray-50 transition"
          >
            <div className="mb-2 md:mb-0">
              <p className="font-semibold text-gray-800">{session.name}</p>
              <p className="text-sm text-gray-500">{session.date}</p>
              {session.location && (
                <p className="text-sm text-gray-400">Location: {session.location}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onEdit(session)}
                className="px-3 py-1 text-sm font-medium bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(session.id)}
                className="px-3 py-1 text-sm font-medium bg-red-500 text-white rounded-md hover:bg-red-600 transition"
              >
                Delete
              </button>
              <Link
                to={`/attendance/${session.id}`}
                className="px-3 py-1 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
              >
                View Attendance
              </Link>
              <Link
                to={`/assessments?sessionId=${session.id}`}
                className="px-3 py-1 text-sm font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700 transition"
              >
                View Assessments
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SessionList;