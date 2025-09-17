// src/pages/Pa360ElevateLandingPage.tsx
import React from 'react';
import { Link } from 'react-router-dom';

const Pa360ElevateLandingPage = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <div className="bg-white p-8 rounded-lg shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">Welcome to pa360 Elevate</h1>
        <p className="text-lg text-gray-600 mb-8">
          Track performance, manage sessions, and visualize progress — all in one platform
          powered by Project Athlete 360.
        </p>
        
        {/* Corrected Link for "Enter pa360 Elevate" */}
        <Link to="/dashboard" className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
          Enter pa360 Elevate
          <svg className="ml-2 -mr-1 w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 010-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
        </Link>
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl w-full">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-2">Sessions</h2>
          <p className="text-gray-600">Organize and manage training sessions with ease.</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-2">Assessments</h2>
          <p className="text-gray-600">Record athlete progress and track key performance data.</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-2">Performance</h2>
          <p className="text-gray-600">Visualize growth and insights with intuitive charts.</p>
        </div>
      </div>
      
      <div className="mt-8">
        {/* Corrected Link for "See full feature list" */}
        <Link to="/features" className="text-indigo-600 hover:underline">
          See full feature list →
        </Link>
      </div>

      <footer className="mt-16 text-sm text-gray-500">
        <p>Need help? Contact <a href="mailto:support@projectathlete360.com" className="hover:underline">support@projectathlete360.com</a></p>
        <div className="flex justify-center space-x-4 mt-2">
          <a href="#" className="hover:underline">Home</a>
          <a href="#" className="hover:underline">Privacy</a>
          <a href="#" className="hover:underline">Terms</a>
        </div>
        <p className="mt-2">#pa360Elevate • Powered by Project Athlete 360</p>
      </footer>
    </div>
  );
};

export default Pa360ElevateLandingPage;
