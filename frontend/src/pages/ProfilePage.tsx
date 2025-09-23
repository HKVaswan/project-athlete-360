// src/pages/ProfilePage.tsx

import React from "react";
import { Button } from "@/components/ui/button";

const ProfilePage: React.FC = () => {
  // Dummy user data (replace with API data later)
  const user = {
    name: "John Doe",
    role: "Athlete",
    email: "john.doe@example.com",
    joined: "January 2024",
    avatar: "https://i.pravatar.cc/150?img=12",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Profile Header */}
      <div className="flex items-center space-x-6">
        <img
          src={user.avatar}
          alt={user.name}
          className="w-24 h-24 rounded-full border shadow-md"
        />
        <div>
          <h1 className="text-3xl font-bold">{user.name}</h1>
          <p className="text-gray-600">{user.role}</p>
          <p className="text-sm text-gray-500">Joined {user.joined}</p>
        </div>
      </div>

      {/* User Info */}
      <div className="bg-white p-4 rounded-xl shadow space-y-2">
        <h2 className="text-xl font-semibold">Profile Information</h2>
        <p>
          <span className="font-medium">Email:</span> {user.email}
        </p>
        <p>
          <span className="font-medium">Role:</span> {user.role}
        </p>
        <div className="pt-2">
          <Button>Edit Profile</Button>
        </div>
      </div>

      {/* Activity Section */}
      <div className="bg-white p-4 rounded-xl shadow space-y-2">
        <h2 className="text-xl font-semibold">Recent Activity</h2>
        <p className="text-gray-500">No recent activity available.</p>
      </div>

      {/* Settings Placeholder */}
      <div className="bg-white p-4 rounded-xl shadow space-y-2">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-gray-500">
          Customize your preferences and privacy settings here.
        </p>
        <Button variant="outline">Go to Settings</Button>
      </div>
    </div>
  );
};

export default ProfilePage;