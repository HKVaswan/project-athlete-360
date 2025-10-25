// src/components/auth/ProtectedRoute.tsx
import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext"; // ✅ fixed relative path

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { isAuthenticated, user } = useAuth();

  // While restoring auth state from localStorage, show a small loader
  if (user === null && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Restoring session...</p>
      </div>
    );
  }

  // Redirect to login if not logged in
  if (!isAuthenticated) {
    console.warn("🔒 Redirecting to /login - not authenticated");
    return <Navigate to="/login" replace />;
  }

  // Redirect if user role isn’t in allowedRoles
  if (allowedRoles && user?.role && !allowedRoles.includes(user.role)) {
    console.warn(`🚫 Unauthorized access attempt by role: ${user.role}`);
    return <Navigate to="/unauthorized" replace />;
  }

  // All checks passed → render child routes
  return <Outlet />;
};

export default ProtectedRoute;