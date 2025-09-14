// src/components/performance/PerformanceSummaryCard.tsx

import React from "react";
import { PerformanceSummary } from "../../types/performance";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface Props {
  summary: PerformanceSummary;
}

const PerformanceSummaryCard: React.FC<Props> = ({ summary }) => {
  const getTrendIcon = () => {
    switch (summary.trend) {
      case "improving":
        return <ArrowUp className="text-green-500" />;
      case "declining":
        return <ArrowDown className="text-red-500" />;
      default:
        return <Minus className="text-gray-400" />;
    }
  };

  return (
    <div className="p-4 bg-white shadow rounded-2xl flex items-center justify-between">
      <div>
        <h3 className="text-lg font-semibold">Performance Summary</h3>
        <p>Average Score: {summary.averageScore}</p>
        <p>Best Score: {summary.bestScore}</p>
      </div>
      <div className="text-3xl">{getTrendIcon()}</div>
    </div>
  );
};

export default PerformanceSummaryCard;
