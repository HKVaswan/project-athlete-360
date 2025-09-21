import React, { useState } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { useAuth } from './../context/AuthContext';
import Navbar from './Navbar';
import Sidebar from './Sidebar'; // You'll need to create this file
import Footer from './Footer';
import { FaSpinner } from 'react-icons/fa';

const Layout: React.FC = () => {
  const { loading, error, isAuthenticated } = useAuth();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Define routes that should not have the full dashboard layout (e.g., login, register)
  const publicRoutes = ['/login', '/register'];
  const isPublicRoute = publicRoutes.includes(location.pathname);

  // Show a full-screen loading spinner while auth state is being determined
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <FaSpinner className="animate-spin text-4xl text-blue-600 dark:text-blue-400" />
        <span className="ml-4 text-lg text-gray-700 dark:text-gray-300">Loading...</span>
      </div>
    );
  }

  // Handle global authentication errors
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 p-8">
        <p>Authentication Error: {error}</p>
      </div>
    );
  }

  // Render a minimal layout for public routes
  if (isPublicRoute) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-grow">
          <Outlet /> {/* Use Outlet for nested routes */}
        </main>
      </div>
    );
  }

  // Render the full dashboard layout for all protected, authenticated routes
  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar isSidebarOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
};

export default Layout;
