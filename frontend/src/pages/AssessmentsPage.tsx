// src/pages/AssessmentsPage.tsx

import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { assessmentsService } from "../services/assessmentsService";
import { Assessment, CreateAssessmentInput } from "../types/assessment";
import AssessmentForm from "../components/assessments/AssessmentForm";
import AssessmentList from "../components/assessments/AssessmentList";

const AssessmentsPage: React.FC = () => {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assessment | null>(null);

  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  useEffect(() => {
    loadAssessments();
  }, [sessionId]);

  const loadAssessments = async () => {
    const data = await assessmentsService.getAll();
    if (sessionId) {
      setAssessments(data.filter((a) => a.session_id === sessionId));
    } else {
      setAssessments(data);
    }
  };

  const handleCreate = async (data: CreateAssessmentInput) => {
    const payload = sessionId ? { ...data, session_id: sessionId } : data;
    await assessmentsService.create(payload);
    setCreating(false);
    loadAssessments();
  };

  const handleUpdate = async (data: CreateAssessmentInput) => {
    if (!editing) return;
    await assessmentsService.update(editing.id, { ...data, id: editing.id });
    setEditing(null);
    loadAssessments();
  };

  const handleDelete = async (id: string) => {
    await assessmentsService.remove(id);
    loadAssessments();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        {sessionId ? "Session Assessments" : "All Assessments"}
      </h1>

      {creating ? (
        <AssessmentForm
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      ) : editing ? (
        <AssessmentForm
          initialData={editing}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <button
            onClick={() => setCreating(true)}
            className="mb-4 px-4 py-2 bg-green-600 text-white rounded-md"
          >
            + New Assessment
          </button>
          <AssessmentList
            assessments={assessments}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  );
};

export default AssessmentsPage;
 
