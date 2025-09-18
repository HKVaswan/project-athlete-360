import React from 'react';
import { useAuth } from '../context/AuthContext';
import Register from './Register';

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const handleRegistrationSuccess = () => {
    alert('New user added successfully!');
    // Optional: add logic to clear form or navigate
  };
  
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-lg mb-6">Welcome, {user?.username}! Use this dashboard to manage user accounts.</p>
      
      <div className="max-w-lg mx-auto">
        <Register isAdminPage={true} onSuccess={handleRegistrationSuccess} />
      </div>
    </div>
  );
};

export default AdminDashboard;
