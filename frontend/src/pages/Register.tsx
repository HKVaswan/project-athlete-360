import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL;

interface RegisterProps {
  onSuccess?: () => void;
  isAdminPage?: boolean;
}

const Register: React.FC<RegisterProps> = ({ onSuccess, isAdminPage = false }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [sport, setSport] = useState('');
  const [gender, setGender] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [role, setRole] = useState('athlete');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { token } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const registrationData = {
      username,
      password,
      name,
      dob,
      sport,
      gender,
      contact_info: contactInfo,
    };
    
    // Only add role if it's an admin creating a user
    const finalData = isAdminPage ? { ...registrationData, role } : registrationData;

    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isAdminPage && token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify(finalData),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to register user.');
      }

      // Handle success based on where the component is used
      if (onSuccess) {
        onSuccess();
      } else {
        navigate('/login');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`p-4 ${!isAdminPage ? 'max-w-lg mx-auto' : ''}`}>
      <h1 className="text-2xl font-bold text-center mb-4">{isAdminPage ? 'Add New User' : 'Register a New Account'}</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        {isAdminPage && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
              disabled={loading}
            >
              <option value="athlete">Athlete</option>
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Sport</label>
          <input
            type="text"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Gender</label>
          <input
            type="text"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Contact Info</label>
          <input
            type="text"
            value={contactInfo}
            onChange={(e) => setContactInfo(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={loading}
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Submitting...' : 'Register'}
        </button>
      </form>
    </div>
  );
};

export default Register;
