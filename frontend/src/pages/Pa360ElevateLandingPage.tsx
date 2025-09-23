// src/pages/Pa360ElevateLandingPage.tsx
import React from "react";
import { Link } from "react-router-dom";
import { FaChartLine, FaClipboardList, FaRunning, FaArrowRight } from "react-icons/fa";

const Pa360ElevateLandingPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-indigo-50 to-white dark:from-gray-900 dark:to-gray-800 text-center">
      {/* Hero Section */}
      <div className="bg-white dark:bg-gray-800 p-10 rounded-xl shadow-2xl max-w-3xl w-full transition-transform hover:scale-[1.01]">
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white mb-4">
          Welcome to <span className="text-indigo-600">pa360 Elevate</span>
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
          Track performance, manage sessions, and visualize progress — all in one
          platform powered by{" "}
          <span className="font-semibold">Project Athlete 360</span>.
        </p>

        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center px-6 py-3 text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md"
        >
          Enter pa360 Elevate
          <FaArrowRight className="ml-2" />
        </Link>
      </div>

      {/* Feature Highlights */}
      <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl w-full">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <FaClipboardList className="text-indigo-600 text-3xl mx-auto mb-3" />
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            Sessions
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Organize and manage training sessions with ease.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <FaRunning className="text-indigo-600 text-3xl mx-auto mb-3" />
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            Assessments
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Record athlete progress and track key performance data.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <FaChartLine className="text-indigo-600 text-3xl mx-auto mb-3" />
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            Performance
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Visualize growth and insights with intuitive charts.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-10">
        <Link
          to="/features"
          className="text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-400 font-medium underline-offset-2 hover:underline transition-colors"
        >
          See full feature list →
        </Link>
      </div>

      {/* Footer */}
      <footer className="mt-16 text-sm text-gray-500 dark:text-gray-400">
        <p>
          Need help? Contact{" "}
          <a
            href="mailto:support@projectathlete360.com"
            className="hover:underline text-indigo-600 dark:text-indigo-400"
          >
            support@projectathlete360.com
          </a>
        </p>
        <div className="flex justify-center space-x-6 mt-2">
          <Link to="/" className="hover:underline">
            Home
          </Link>
          <a href="#" className="hover:underline">
            Privacy
          </a>
          <a href="#" className="hover:underline">
            Terms
          </a>
        </div>
        <p className="mt-2 font-medium">#pa360Elevate • Powered by Project Athlete 360</p>
      </footer>
    </div>
  );
};

export default Pa360ElevateLandingPage;