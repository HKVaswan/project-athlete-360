// src/components/Layout.tsx
import React, { useState, useEffect } from 'react';
import { useLocation, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './../context/AuthContext';
import Navbar from './Navbar';
import Footer from './Footer';
import { FaSpinner } from 'react-icons/fa';

const Layout: React.FC = () => {
  const { isAuthenticated, authError, checkAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  const publicRoutes = ['/login', '/register', '/pa360', '/create-admin'];
  const isPublicRoute = publicRoutes.includes(location.pathname);

  useEffect(() => {
    const verify = async () => {
      await checkAuth();
      setChecking(false);
    };
    verify();
  }, [checkAuth]);

  useEffect(() => {
    if (!checking) {
      if (authError && !isPublicRoute) navigate('/login');
      if (!isAuthenticated && !isPublicRoute) navigate('/login');
    }
  }, [checking, authError, isAuthenticated, isPublicRoute, navigate]);

  if (checking && !isPublicRoute) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <FaSpinner className="animate-spin text-4xl text-blue-600 dark:text-blue-400" />
        <span className="ml-4 text-lg text-gray-700 dark:text-gray-300">
          Checking session...
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900">
      <Navbar />
      <main className={`flex-1 ${isPublicRoute ? '' : 'overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8'}`}>
        <Outlet />
      </main>
      {!isPublicRoute && <Footer />}
    </div>
  );
};

export default Layout;