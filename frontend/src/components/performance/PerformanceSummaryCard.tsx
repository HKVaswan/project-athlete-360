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
    <div className="p-4 bg-white shadow rounded-2xl flex items-center justify-between space-x-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">Performance Summary</h3>
        <p className="text-gray-600">Average Score: <span className="font-medium">{summary.averageScore}</span></p>
        <p className="text-gray-600">Best Score: <span className="font-medium">{summary.bestScore}</span></p>
      </div>
      <div className="text-4xl flex-shrink-0">{getTrendIcon()}</div>
    </div>
  );
};

export default PerformanceSummaryCard;