// src/pages/AddAthletePage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL;

// Reusable input component
interface InputFieldProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
}

const InputField: React.FC<InputFieldProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
  required = true,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
      disabled={disabled}
      required={required}
    />
  </div>
);

// Gender select component
interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  disabled?: boolean;
  required?: boolean;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options, disabled = false, required = true }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    <select
      value={value}
      onChange={onChange}
      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
      disabled={disabled}
      required={required}
    >
      <option value="">Select {label}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  </div>
);

const AddAthletePage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [sport, setSport] = useState('');
  const [gender, setGender] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const newAthlete = {
      username,
      password,
      name,
      dob,
      sport,
      gender,
      contact_info: contactInfo,
    };

    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(newAthlete),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to add athlete.');
      }

      navigate('/athletes');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto bg-white rounded-xl shadow-md space-y-6">
      <h1 className="text-2xl font-bold text-center">Add New Athlete</h1>

      {error && <p className="text-red-500 text-sm text-center">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={loading} />
        <InputField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
        <InputField label="Full Name" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} />
        <InputField label="Date of Birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} disabled={loading} />
        <InputField label="Sport" value={sport} onChange={(e) => setSport(e.target.value)} disabled={loading} />
        <SelectField
          label="Gender"
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          options={['Male', 'Female', 'Other']}
          disabled={loading}
        />
        <InputField label="Contact Info" value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} disabled={loading} />

        <button
          type="submit"
          className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Adding...' : 'Add Athlete'}
        </button>
      </form>
    </div>
  );
};

export default AddAthletePage;