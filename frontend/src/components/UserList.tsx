import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { FaUserShield, FaUserTie, FaRunning, FaTimesCircle } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL;

interface User {
  id: number;
  username: string;
  role: string;
}

const UserList: React.FC = () => {
  const { token, logout } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/users`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          logout();
          return;
        }

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.message || 'Failed to fetch users.');
        }

        const { data } = await response.json();
        setUsers(data);
      } catch (err: any) {
        setError(err.message || 'An error occurred while fetching the user list.');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [token, logout]);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <FaUserShield className="text-purple-600" />;
      case 'coach':
        return <FaUserTie className="text-blue-600" />;
      case 'athlete':
        return <FaRunning className="text-green-600" />;
      default:
        return null;
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        const response = await fetch(`${API_URL}/api/users/${userId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.message || 'Failed to delete user.');
        }

        // Remove the user from the state
        setUsers(users.filter(user => user.id !== userId));
      } catch (err: any) {
        alert(`Error: ${err.message}`);
      }
    }
  };

  if (loading) return <div className="p-4 text-center">Loading users...</div>;
  if (error) return <div className="p-4 text-red-500 text-center">{error}</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {users.length === 0 ? (
        <p className="text-gray-500 text-center">No users found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {users.map((user) => (
            <li key={user.id} className="py-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {getRoleIcon(user.role)}
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">{user.username}</h2>
                  <p className="text-sm text-gray-500 capitalize">{user.role}</p>
                </div>
              </div>
              <button
                onClick={() => handleDeleteUser(user.id)}
                className="text-red-500 hover:text-red-700 p-2"
                aria-label={`Delete user ${user.username}`}
              >
                <FaTimesCircle size={20} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default UserList;
 
