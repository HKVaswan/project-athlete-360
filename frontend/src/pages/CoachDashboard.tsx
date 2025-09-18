import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const CoachDashboard: React.FC = () => {
  const { user } = useAuth();
  
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold mb-4">Welcome, Coach {user?.username || ''}!</h1>
      <p className="text-lg mb-6">This is your dashboard. Use the navigation to manage your athletes.</p>
      
      <div className="flex space-x-4">
        <Link 
          to="/athletes" 
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          View All Athletes
        </Link>
        <Link 
          to="/add-athlete" 
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
        >
          Add New Athlete
        </Link>
      </div>
    </div>
  );
};

export default CoachDashboard;
