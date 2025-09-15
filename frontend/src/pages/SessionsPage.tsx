// src/pages/SessionsPage.tsx

import React, { useEffect, useState } from 'react';
import { sessionsService } from '../services/sessionsService';
import { Session, SessionPayload } from '../types/session';
import SessionForm from '../components/sessions/SessionForm';
import SessionList from '../components/sessions/SessionList';

const SessionsPage: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Session | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    const data = await sessionsService.getSessions();
    setSessions(data);
  };

  const handleCreate = async (payload: SessionPayload) => {
    await sessionsService.createSession(payload);
    setCreating(false);
    loadSessions();
  };

  const handleUpdate = async (payload: SessionPayload) => {
    if (!editing) return;
    await sessionsService.updateSession(editing.id, payload);
    setEditing(null);
    loadSessions();
  };

  const handleDelete = async (id: string) => {
    await sessionsService.deleteSession(id);
    loadSessions();
  };

  const handleEditClick = (session: Session) => {
    setEditing(session);
    setCreating(false);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Sessions</h1>

      {(creating || editing) ? (
        <SessionForm
          initialData={editing || undefined}
          onSubmit={editing ? handleUpdate : handleCreate}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : (
        <>
          <button
            onClick={() => setCreating(true)}
            className="mb-4 px-4 py-2 text-white bg-green-600 rounded-md"
          >
            + Add New Session
          </button>
          <SessionList
            sessions={sessions}
            onEdit={handleEditClick}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  );
};

export default SessionsPage;
