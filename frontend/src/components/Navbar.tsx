// src/components/Navbar.tsx

import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <nav className="bg-white shadow-md px-6 py-4 flex items-center justify-between">
      {/* Brand */}
      <div className="text-xl font-bold text-blue-600">
        <Link to="/">Project Athlete 360</Link>
      </div>

      {/* Links */}
      <div className="flex space-x-6">
        <Link to="/dashboard" className="hover:text-blue-500">
          Dashboard
        </Link>
        <Link to="/athletes" className="hover:text-blue-500">
          Athletes
        </Link>
        <Link to="/create-athlete" className="hover:text-blue-500">
          Create Athlete
        </Link>
        <Link to="/login" className="hover:text-blue-500">
          Login
        </Link>

        {/* ✅ New pa360 Elevate link */}
        <Link
          to="/elevate"
          className="px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          pa360 Elevate
        </Link>
      </div>
    </nav>
  );
}
