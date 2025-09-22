import React, { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL;

const CreateAdmin: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          role: 'admin'
        }),
      });
      const data = await res.json();
      setMessage(data.message || 'Admin created successfully!');
    } catch (err) {
      setMessage('Error creating admin.');
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto mt-20 bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4">Create Admin Account</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required className="w-full p-2 border rounded"/>
        <input placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required type="password" className="w-full p-2 border rounded"/>
        <input placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border rounded"/>
        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded">Create Admin</button>
      </form>
      {message && <p className="mt-3">{message}</p>}
    </div>
  );
};

export default CreateAdmin;