// src/components/UserList.tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { FaUserShield, FaUserTie, FaRunning, FaTimesCircle, FaUserAlt } from 'react-icons/fa';

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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/users`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
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
        if (isMounted) setUsers(data);
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Error fetching users.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchUsers();

    return () => {
      isMounted = false;
      controller.abort();
    };
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
        return <FaUserAlt className="text-gray-400" />;
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;

    try {
      const response = await fetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to delete user.');
      }

      setUsers(users.filter(user => user.id !== userId));
      setSuccessMessage('User deleted successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete user.');
      setTimeout(() => setError(null), 3000);
    }
  };

  const UserItem: React.FC<{ user: User }> = ({ user }) => (
    <li className="py-4 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        {getRoleIcon(user.role)}
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{user.username}</h2>
          <p className="text-sm text-gray-500 capitalize">{user.role}</p>
        </div>
      </div>
      <button
        onClick={() => handleDeleteUser(user.id)}
        className="text-red-500 hover:text-red-700 p-3"
        aria-label={`Delete user ${user.username}`}
      >
        <FaTimesCircle size={20} />
      </button>
    </li>
  );

  if (loading) return <div className="p-4 text-center">Loading users...</div>;
  if (error) return <div className="p-4 text-red-500 text-center">{error}</div>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md space-y-4">
      {successMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded text-center">
          {successMessage}
        </div>
      )}
      {users.length === 0 ? (
        <p className="text-gray-500 text-center">No users found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {users.map(user => <UserItem key={user.id} user={user} />)}
        </ul>
      )}
    </div>
  );
};

export default UserList;