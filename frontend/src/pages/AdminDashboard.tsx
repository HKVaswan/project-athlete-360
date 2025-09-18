import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Register from './Register';
import UserList from '../components/UserList';

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const [showAddUser, setShowAddUser] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRegistrationSuccess = () => {
    setShowAddUser(false);
    setRefreshKey(prevKey => prevKey + 1);
  };
  
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-lg mb-6">Welcome, {user?.username}! Manage users and system settings.</p>
      
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">User Management</h2>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            {showAddUser ? 'View All Users' : 'Add New User'}
          </button>
        </div>
        
        {showAddUser ? (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <Register isAdminPage={true} onSuccess={handleRegistrationSuccess} />
          </div>
        ) : (
          <UserList key={refreshKey} />
        )}
      </div>

      {/* Additional admin sections can be added here */}
      <div className="mt-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold">System Metrics (Future Feature)</h2>
        <p className="text-gray-500 mt-2">Coming soon: System-wide metrics, activity logs, and more advanced tools.</p>
      </div>
    </div>
  );
};

export default AdminDashboard;
