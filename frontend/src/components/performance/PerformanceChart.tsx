// src/components/performance/PerformanceChart.tsx
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { PerformanceData } from "../../types/performance";

interface PerformanceChartProps {
  data: PerformanceData[];
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ data }) => {
  return (
    <div className="p-4 bg-white shadow rounded-2xl">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">
        Performance Over Time
      </h2>
      {data.length === 0 ? (
        <p className="text-gray-500">No performance data available.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tick={{ fill: "#6b7280" }} />
            <YAxis tick={{ fill: "#6b7280" }} />
            <Tooltip contentStyle={{ backgroundColor: "#f9fafb", borderRadius: 8 }} />
            <Legend verticalAlign="top" height={36} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#3b82f6"
              name="Score"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default PerformanceChart;