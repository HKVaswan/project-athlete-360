// src/pages/Register.tsx

import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  FaUserPlus,
  FaSpinner,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import SEO from "../components/SEO"; // <- Import SEO here

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
  role: "athlete",
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
      !(emailRegex.test(fields.contactInfo) || phoneRegex.test(fields.contactInfo))
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
    <>
      {/* --------------- SEO ----------------- */}
      <SEO
        title="Register - Project Athlete 360"
        description="Create your Project Athlete 360 account and start managing athletes and training plans."
        url="https://projectathlete360.com/register"
      />
      {/* --------------- SEO ----------------- */}

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
            {/* ... All form fields remain unchanged ... */}
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
    </>
  );
};

/* -------------------------
   Reusable Form Components
--------------------------*/
// ... InputField, SelectField, Alert remain the same

export default Register;