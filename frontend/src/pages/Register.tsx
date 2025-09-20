import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaUserPlus, FaSpinner, FaCheckCircle } from 'react-icons/fa';

const API_URL = (process.env.REACT_APP_API_URL || "https://project-athlete-360.onrender.com").replace(/\/+$/, "");

const initialFields = {
  username: "",
  password: "",
  confirmPassword: "",
  name: "",
  dob: "",
  sport: "",
  gender: "",
  contactInfo: "",
  role: "athlete", // Default, but you can hide/show role selection
};

const emailRegex = /^[\w\-\.]+@([\w\-]+\.)+[\w\-]{2,4}$/;
const phoneRegex = /^\+?\d{10,15}$/;

const Register: React.FC = () => {
  const [fields, setFields] = useState(initialFields);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  // Validate all fields before submit
  const validateForm = () => {
    if (!fields.username.trim() || fields.username.length < 3)
      return "Username must be at least 3 characters.";
    if (!fields.password || fields.password.length < 6)
      return "Password must be at least 6 characters.";
    if (fields.password !== fields.confirmPassword)
      return "Passwords do not match.";
    if (!fields.name.trim())
      return "Full name is required.";
    if (!fields.dob)
      return "Date of birth is required.";
    if (new Date(fields.dob) > new Date())
      return "Date of birth cannot be in the future.";
    if (!fields.sport.trim())
      return "Sport is required.";
    if (!["male", "female", "other"].includes(fields.gender))
      return "Please select a valid gender.";
    if (!fields.contactInfo.trim())
      return "Contact info required.";
    if (!(emailRegex.test(fields.contactInfo) || phoneRegex.test(fields.contactInfo)))
      return "Contact info must be a valid email or phone number.";
    return null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields({ ...fields, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);

    const registrationData = {
      username: fields.username.trim(),
      password: fields.password,
      name: fields.name.trim(),
      dob: fields.dob,
      sport: fields.sport.trim(),
      gender: fields.gender,
      contact_info: fields.contactInfo.trim(),
      role: fields.role,
    };

    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registrationData),
      });

      // If backend unreachable, catch fetch errors
      if (!response) {
        setError("Cannot reach registration server. Try again later.");
        setLoading(false);
        return;
      }

      let data = {};
      try {
        data = await response.json();
      } catch {
        setError("Server returned an invalid response. Please contact support.");
        setLoading(false);
        return;
      }

      // Use backend error message if any
      if (response.ok && (data as any).success) {
        setSuccess(true);
        setTimeout(() => navigate("/login"), 1800);
      } else {
        setError((data as any).message || "Registration failed. Please check your details and try again.");
      }
    } catch (err: any) {
      setError("Could not connect to registration server. Please check your internet or try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 sm:p-10 w-full max-w-lg transition-all duration-300 transform scale-95 md:scale-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
            Create Your Account
          </h1>
          <p className="text-gray-500 dark:text-gray-400">Join Project Athlete 360</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                value={fields.username}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                placeholder="Choose a username"
                required
                minLength={3}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={fields.password}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                placeholder="Minimum 6 characters"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={fields.confirmPassword}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
              placeholder="Re-type password"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <hr className="border-gray-200 dark:border-gray-700" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={fields.name}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                placeholder="e.g., John Doe"
                required
              />
            </div>
            <div>
              <label htmlFor="dob" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date of Birth
              </label>
              <input
                id="dob"
                name="dob"
                type="date"
                value={fields.dob}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                required
                max={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div>
              <label htmlFor="sport" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sport
              </label>
              <input
                id="sport"
                name="sport"
                type="text"
                value={fields.sport}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                placeholder="e.g., Football, Swimming"
                required
              />
            </div>
            <div>
              <label htmlFor="gender" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Gender
              </label>
              <select
                id="gender"
                name="gender"
                value={fields.gender}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                required
              >
                <option value="">Select...</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="contactInfo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Contact Info (Email or Phone)
              </label>
              <input
                id="contactInfo"
                name="contactInfo"
                type="text"
                value={fields.contactInfo}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                placeholder="Email or phone number"
                required
              />
            </div>
            {/* You can hide/show this role selector as needed */}
            {/* <div className="md:col-span-2">
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Role
              </label>
              <select
                id="role"
                name="role"
                value={fields.role}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900"
                required
              >
                <option value="athlete">Athlete</option>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </div> */}
          </div>
          {error && (
            <div className="text-center text-sm text-red-500 bg-red-100 dark:bg-red-900 p-3 rounded-md">
              {error}
            </div>
          )}
          {success && (
            <div className="text-center text-green-600 bg-green-100 dark:bg-green-900 p-3 rounded-md flex items-center justify-center space-x-2">
              <FaCheckCircle />
              <span>Registration successful! Redirecting to login…</span>
            </div>
          )}
          <button
            type="submit"
            className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:bg-blue-400"
            disabled={loading}
          >
            {loading ? (
              <>
                <FaSpinner className="animate-spin" />
                <span>Registering...</span>
              </>
            ) : (
              <>
                <FaUserPlus />
                <span>Register</span>
              </>
            )}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
