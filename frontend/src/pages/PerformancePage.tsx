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

  useEffect(() => {
    if (athleteId) {
      performanceService.getAthletePerformance(athleteId).then(setData);
      performanceService.getPerformanceSummary(athleteId).then(setSummary);
    }
  }, [athleteId]);

  return (
    <div className="space-y-4">
      <Button onClick={() => navigate(-1)} variant="outline">
        Back to Athletes
      </Button>
      {summary && <PerformanceSummaryCard summary={summary} />}
      {data.length > 0 ? (
        <PerformanceChart data={data} />
      ) : (
        <p>No performance data available.</p>
      )}
    </div>
  );
};

export default PerformancePage;
 
