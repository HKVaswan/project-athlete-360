// src/pages/PerformancePage.tsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { performanceService } from "../services/performanceService";
import { PerformanceData, PerformanceSummary } from "../types/performance";
import PerformanceChart from "../components/performance/PerformanceChart";
import PerformanceSummaryCard from "../components/performance/PerformanceSummaryCard";
import { Button } from "@/components/ui/button";

const PerformancePage: React.FC = () => {
  const { athleteId } = useParams<{ athleteId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<PerformanceData[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPerformance = async () => {
      if (!athleteId) return;
      setLoading(true);
      setError(null);

      try {
        const [performanceData, performanceSummary] = await Promise.all([
          performanceService.getAthletePerformance(athleteId),
          performanceService.getPerformanceSummary(athleteId),
        ]);
        setData(performanceData);
        setSummary(performanceSummary);
      } catch (err: any) {
        console.error("Failed to fetch performance data:", err);
        setError("Unable to load performance data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, [athleteId]);

  return (
    <div className="p-6 space-y-6">
      {/* Back button */}
      <Button onClick={() => navigate(-1)} variant="outline">
        ← Back to Athletes
      </Button>

      {/* Page title */}
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Athlete Performance
      </h1>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-md">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <p className="text-gray-500 dark:text-gray-400">Loading performance data…</p>
      )}

      {/* Performance Summary */}
      {!loading && summary && <PerformanceSummaryCard summary={summary} />}

      {/* Performance Data / Chart */}
      {!loading && data.length > 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
          <PerformanceChart data={data} />
        </div>
      ) : (
        !loading && (
          <p className="text-gray-500 dark:text-gray-400 italic">
            No performance data available.
          </p>
        )
      )}
    </div>
  );
};

export default PerformancePage;