import React from 'react';

const AllUsers: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Users</h1>
      <p>This page will display all registered users (admin, coaches, athletes).</p>
      {/* TODO: Add table/list of users with actions like edit/delete */}
    </div>
  );
};

export default AllUsers;
