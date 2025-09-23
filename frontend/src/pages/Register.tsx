// src/pages/Register.tsx

import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  FaUserPlus,
  FaSpinner,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";

import SEO from "../components/SEO";

const Register = () => {
  return (
    <>
      <SEO
        title="Register - Project Athlete 360"
        description="Create your Project Athlete 360 account and start managing athletes and training plans."
        url="https://projectathlete360.com/register"
      />
      {/* Rest of your Register page JSX */}
    </>
  );
};

const API_URL = (
  process.env.REACT_APP_API_URL ||
  "https://project-athlete-360.onrender.com"
).replace(/\/+$/, "");

const initialFields = {
  username: "",
  password: "",
  confirmPassword: "",
  name: "",
  dob: "",
  sport: "",
  gender: "",
  contactInfo: "",
  role: "athlete", // default
};

const emailRegex = /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/;
const phoneRegex = /^\+?\d{10,15}$/;

const Register: React.FC = () => {
  const [fields, setFields] = useState(initialFields);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const validateForm = () => {
    if (fields.username.trim().length < 3)
      return "Username must be at least 3 characters.";
    if (fields.password.length < 6)
      return "Password must be at least 6 characters.";
    if (fields.password !== fields.confirmPassword)
      return "Passwords do not match.";
    if (!fields.name.trim()) return "Full name is required.";
    if (!fields.dob) return "Date of birth is required.";
    if (new Date(fields.dob) > new Date())
      return "Date of birth cannot be in the future.";
    if (!fields.sport.trim()) return "Sport is required.";
    if (!["male", "female", "other"].includes(fields.gender))
      return "Please select a valid gender.";
    if (!fields.contactInfo.trim()) return "Contact info is required.";
    if (
      !(
        emailRegex.test(fields.contactInfo) ||
        phoneRegex.test(fields.contactInfo)
      )
    )
      return "Contact info must be a valid email or phone number.";
    if (!["athlete", "coach", "admin"].includes(fields.role))
      return "Please select a valid role.";
    return null;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFields({ ...fields, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

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

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => navigate("/login"), 1800);
      } else {
        setError(
          data.message ||
            "Registration failed. Please check your details and try again."
        );
      }
    } catch (err: any) {
      setError(
        "Network error. Could not connect to the registration server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 sm:p-10 w-full max-w-lg transition-all duration-300">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
            Create Your Account
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Join Project Athlete 360
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
          {/* Username + Password */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              id="username"
              name="username"
              label="Username"
              type="text"
              value={fields.username}
              onChange={handleChange}
              placeholder="Choose a username"
              disabled={loading}
              required
            />
            <InputField
              id="password"
              name="password"
              label="Password"
              type="password"
              value={fields.password}
              onChange={handleChange}
              placeholder="Minimum 6 characters"
              disabled={loading}
              required
            />
          </div>

          {/* Confirm Password */}
          <InputField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm Password"
            type="password"
            value={fields.confirmPassword}
            onChange={handleChange}
            placeholder="Re-type password"
            disabled={loading}
            required
          />

          <hr className="border-gray-200 dark:border-gray-700" />

          {/* Name, DOB, Sport, Gender */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              id="name"
              name="name"
              label="Full Name"
              type="text"
              value={fields.name}
              onChange={handleChange}
              disabled={loading}
              required
            />
            <InputField
              id="dob"
              name="dob"
              label="Date of Birth"
              type="date"
              value={fields.dob}
              onChange={handleChange}
              disabled={loading}
              required
            />
            <InputField
              id="sport"
              name="sport"
              label="Sport"
              type="text"
              value={fields.sport}
              onChange={handleChange}
              disabled={loading}
              required
            />
            <SelectField
              id="gender"
              name="gender"
              label="Gender"
              value={fields.gender}
              onChange={handleChange}
              disabled={loading}
              required
              options={[
                { value: "", label: "Select…" },
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "other", label: "Other" },
              ]}
            />
          </div>

          {/* Contact Info */}
          <InputField
            id="contactInfo"
            name="contactInfo"
            label="Contact Info (Email or Phone)"
            type="text"
            value={fields.contactInfo}
            onChange={handleChange}
            placeholder="Email or phone number"
            disabled={loading}
            required
          />

          {/* Role Selection */}
          <SelectField
            id="role"
            name="role"
            label="Role"
            value={fields.role}
            onChange={handleChange}
            disabled={loading}
            options={[
              { value: "athlete", label: "Athlete" },
              { value: "coach", label: "Coach (Restricted)", disabled: true },
              { value: "admin", label: "Admin (Restricted)", disabled: true },
            ]}
          />
          <p className="text-xs text-gray-500 mt-1">
            Only Athletes can register directly. For Coach/Admin access, please
            contact the administrator.
          </p>

          {/* Messages */}
          {error && (
            <Alert type="error" message={error} icon={<FaExclamationTriangle />} />
          )}
          {success && (
            <Alert
              type="success"
              message="Registration successful! Redirecting to login…"
              icon={<FaCheckCircle />}
            />
          )}

          {/* Submit */}
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

        {/* Login link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

/* -------------------------
   Reusable Form Components
--------------------------*/

interface InputFieldProps {
  id: string;
  name: string;
  label: string;
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}

const InputField: React.FC<InputFieldProps> = ({
  id,
  name,
  label,
  type,
  value,
  onChange,
  disabled,
  required,
  placeholder,
}) => (
  <div>
    <label
      htmlFor={id}
      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {label}
    </label>
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      className="w-full px-4 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
    />
  </div>
);

interface SelectFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  required?: boolean;
  options: { value: string; label: string; disabled?: boolean }[];
}

const SelectField: React.FC<SelectFieldProps> = ({
  id,
  name,
  label,
  value,
  onChange,
  disabled,
  required,
  options,
}) => (
  <div>
    <label
      htmlFor={id}
      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {label}
    </label>
    <select
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      disabled={disabled}
      required={required}
      className="w-full px-4 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

interface AlertProps {
  type: "error" | "success";
  message: string;
  icon: React.ReactNode;
}

const Alert: React.FC<AlertProps> = ({ type, message, icon }) => (
  <div
    className={`text-center text-sm ${
      type === "error" ? "text-red-500 bg-red-100" : "text-green-600 bg-green-100"
    } p-3 rounded-md flex items-center justify-center space-x-2`}
  >
    {icon}
    <span>{message}</span>
  </div>
);

export default Register;