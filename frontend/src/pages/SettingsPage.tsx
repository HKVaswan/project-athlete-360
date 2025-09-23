import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

const SettingsPage: React.FC = () => {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">Settings</h1>
      <p className="text-gray-600">
        Manage your account, preferences, and notifications here.
      </p>

      {/* Account Section */}
      <div className="bg-white p-4 rounded-lg shadow space-y-2">
        <h2 className="text-xl font-semibold">Account Settings</h2>
        <p className="text-gray-500">Update your email, password, or account details.</p>
        <div className="mt-2 flex space-x-2">
          <Button onClick={() => alert('Change password flow coming soon')}>Change Password</Button>
          <Button onClick={() => alert('Delete account flow coming soon')} variant="destructive">Delete Account</Button>
        </div>
      </div>

      {/* Preferences Section */}
      <div className="bg-white p-4 rounded-lg shadow space-y-2">
        <h2 className="text-xl font-semibold">Preferences</h2>
        <div className="flex items-center justify-between">
          <span>Email Notifications</span>
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={() => setEmailNotifications((prev) => !prev)}
            className="h-5 w-5"
          />
        </div>
        <div className="flex items-center justify-between">
          <span>SMS Notifications</span>
          <input
            type="checkbox"
            checked={smsNotifications}
            onChange={() => setSmsNotifications((prev) => !prev)}
            className="h-5 w-5"
          />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;