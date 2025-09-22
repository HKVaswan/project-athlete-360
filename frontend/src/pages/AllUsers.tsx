// src/pages/AllUsers.tsx
import React from 'react';
import UserList from '../components/UserList';

const AllUsers: React.FC = () => {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-white">
        All Users
      </h1>
      <p className="mb-4 text-gray-600 dark:text-gray-300">
        Below is a list of all registered users, including admins, coaches, and athletes. You can view details or delete users if necessary.
      </p>
      <UserList />
    </div>
  );
};

export default AllUsers;