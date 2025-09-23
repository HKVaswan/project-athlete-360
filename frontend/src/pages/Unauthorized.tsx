import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Unauthorized: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 dark:bg-red-900 px-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg text-center">
        <h1 className="text-4xl font-extrabold text-red-700 dark:text-red-400 mb-4">
          Access Denied
        </h1>
        <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
          You do not have the required permissions to view this page.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="text-red-700 dark:text-red-400 border-red-700 dark:border-red-400"
        >
          ← Go Back
        </Button>
      </div>
    </div>
  );
};

export default Unauthorized;