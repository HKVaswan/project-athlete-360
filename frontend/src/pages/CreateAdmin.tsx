// src/pages/CreateAdmin.tsx

import React, { useState } from 'react';
import { FaSpinner } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL;

const CreateAdmin: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setSuccess(false);

    // Basic validation
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters long.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          confirmPassword: password,
          name,
          dob: '1990-01-01',
          sport: 'Admin',
          gender: 'other',
          contactInfo: 'admin@example.com',
          role: 'admin',
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(data.message || 'Admin created successfully!');
        setSuccess(true);
        // Reset form
        setUsername('');
        setPassword('');
        setName('');
      } else {
        setMessage(data.message || 'Failed to create admin.');
      }
    } catch (err) {
      console.error(err);
      setMessage('Error creating admin. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto mt-20 bg-white dark:bg-gray-800 rounded shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Create Admin Account</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <input
          placeholder="Full Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white p-2 rounded flex items-center justify-center disabled:opacity-50"
        >
          {loading ? <FaSpinner className="animate-spin mr-2" /> : null}
          Create Admin
        </button>
      </form>

      {message && (
        <p
          className={`mt-4 text-center ${
            success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
};

export default CreateAdmin;