import React from 'react';

const Unauthorized: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-red-100 text-red-700">
      <h1 className="text-3xl font-bold mb-4">Access Denied</h1>
      <p className="text-lg text-center">You do not have the required permissions to view this page.</p>
    </div>
  );
};

export default Unauthorized;
