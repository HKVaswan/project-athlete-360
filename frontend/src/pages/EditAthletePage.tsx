import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL;

const EditAthletePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, logout } = useAuth();
  const [athlete, setAthlete] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [sport, setSport] = useState('');
  const [gender, setGender] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  const fetchAthlete = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/athletes/${id}`, {
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
        throw new Error(errData.message || 'Failed to fetch athlete profile.');
      }

      const { data } = await response.json();
      setAthlete(data);
      // Pre-populate form fields
      setName(data.name || '');
      setDob(data.dob ? format(new Date(data.dob), 'yyyy-MM-dd') : '');
      setSport(data.sport || '');
      setGender(data.gender || '');
      setContactInfo(data.contact_info || '');
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching the profile.');
    } finally {
      setLoading(false);
    }
  }, [id, token, logout]);

  useEffect(() => {
    fetchAthlete();
  }, [fetchAthlete]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const updatedAthlete = {
      name,
      dob,
      sport,
      gender,
      contact_info: contactInfo,
    };

    try {
      const response = await fetch(`${API_URL}/api/athletes/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updatedAthlete),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to update athlete.');
      }

      navigate(`/athletes/${id}`);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;
  if (!athlete) return <div className="p-4">Athlete not found.</div>;

  return (
    <div className="p-4 max-w-lg mx-auto bg-white rounded-xl shadow-md space-y-4">
      <h1 className="text-2xl font-bold text-center">Edit {athlete.name}'s Profile</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <div>
          <label className="block text-sm font-medium text-gray-700">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            disabled={isSubmitting}
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
            disabled={isSubmitting}
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
            disabled={isSubmitting}
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
            disabled={isSubmitting}
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
            disabled={isSubmitting}
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
};

export default EditAthletePage;
