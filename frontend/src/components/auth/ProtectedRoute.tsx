// src/components/auth/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { isAuthenticated, user, checkingAuth } = useAuth();

  // Show loading while auth state is being verified
  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Checking authentication...</p>
      </div>
    );
  }

  // Redirect if not logged in
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Redirect if role is not allowed
  if (allowedRoles && user?.role && !allowedRoles.includes(user.role)) {
    console.warn(`Unauthorized access attempt for role: ${user.role}`);
    return <Navigate to="/unauthorized" replace />;
  }

  // Render child routes if authorized
  return <Outlet />;
};

export default ProtectedRoute;