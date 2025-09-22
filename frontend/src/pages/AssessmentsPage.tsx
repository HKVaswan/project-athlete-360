// src/pages/AssessmentsPage.tsx
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { assessmentsService } from "../services/assessmentsService";
import { Assessment, CreateAssessmentInput } from "../types/assessment";
import AssessmentForm from "../components/assessments/AssessmentForm";
import AssessmentList from "../components/assessments/AssessmentList";
import { FaSpinner } from "react-icons/fa";

const AssessmentsPage: React.FC = () => {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  useEffect(() => {
    loadAssessments();
  }, [sessionId]);

  const loadAssessments = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await assessmentsService.getAll();
      if (sessionId) {
        setAssessments(data.filter((a) => a.session_id === sessionId));
      } else {
        setAssessments(data);
      }
    } catch (err: any) {
      setError("Failed to load assessments. Please try again.");
    } finally {
      setLoading(false);
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
    if (window.confirm("Are you sure you want to delete this assessment?")) {
      await assessmentsService.remove(id);
      loadAssessments();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-blue-500">
        <FaSpinner className="animate-spin mr-2 text-2xl" />
        <span>Loading assessments...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center mt-6">{error}</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">
        {sessionId ? "Session Assessments" : "All Assessments"}
      </h1>

      {creating || editing ? (
        <AssessmentForm
          initialData={editing ?? undefined}
          onSubmit={creating ? handleCreate : handleUpdate}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : (
        <>
          <button
            onClick={() => setCreating(true)}
            className="mb-4 px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
          >
            + New Assessment
          </button>
          {assessments.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No assessments found.</p>
          ) : (
            <AssessmentList
              assessments={assessments}
              onEdit={setEditing}
              onDelete={handleDelete}
            />
          )}
        </>
      )}
    </div>
  );
};

export default AssessmentsPage;