// src/pages/Analytics.tsx
import React from 'react';

const Analytics: React.FC = () => {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">
        Analytics Dashboard
      </h1>
      <p className="mb-6 text-gray-600 dark:text-gray-300">
        Monitor athlete performance, system usage, and other key metrics here. Charts and graphs will help you visualize trends effectively.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Placeholder cards for analytics */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center h-64">
          <p className="text-gray-500 dark:text-gray-400">Chart 1 Placeholder</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center h-64">
          <p className="text-gray-500 dark:text-gray-400">Chart 2 Placeholder</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center h-64">
          <p className="text-gray-500 dark:text-gray-400">Chart 3 Placeholder</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex flex-col items-center justify-center h-64">
          <p className="text-gray-500 dark:text-gray-400">Chart 4 Placeholder</p>
        </div>
      </div>
    </div>
  );
};

export default Analytics;