import React from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { FaSpinner } from "react-icons/fa";

// Components
import Navbar from "./components/Navbar";
import Layout from "./components/Layout";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import AthleteDashboard from "./pages/AthleteDashboard";
import CoachDashboard from "./pages/CoachDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import AthletesPage from "./pages/AthletesPage";
import AthleteProfile from "./pages/AthleteProfile";
import AddAthletePage from "./pages/AddAthletePage";
import EditAthletePage from "./pages/EditAthletePage";

// --- Robust Route Guards ---
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};

const RequireRole: React.FC<{ role: string; children: React.ReactNode }> = ({ role, children }) => {
  const { user } = useAuth();
  if (!user || user.role !== role) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const RequireRoles: React.FC<{ roles: string[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const HomeRedirect: React.FC = () => {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><FaSpinner className="animate-spin text-4xl text-blue-600" /></div>;
  }
  if (!isAuthenticated() || !user) {
    return <Navigate to="/login" replace />;
  }
  switch (user.role) {
    case "athlete":
      return <Navigate to="/athlete-dashboard" replace />;
    case "coach":
      return <Navigate to="/coach-dashboard" replace />;
    case "admin":
      return <Navigate to="/admin-dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
};

// --- Main App ---
const App: React.FC = () => {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <FaSpinner className="animate-spin text-4xl text-blue-600" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<HomeRedirect />} />
      {/* Protected Routes */}
      <Route element={<Layout />}>
        <Route
          path="/athlete-dashboard"
          element={
            <RequireAuth>
              <RequireRole role="athlete">
                <AthleteDashboard />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/coach-dashboard"
          element={
            <RequireAuth>
              <RequireRole role="coach">
                <CoachDashboard />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/admin-dashboard"
          element={
            <RequireAuth>
              <RequireRole role="admin">
                <AdminDashboard />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/athletes"
          element={
            <RequireAuth>
              <RequireRoles roles={["coach", "admin"]}>
                <AthletesPage />
              </RequireRoles>
            </RequireAuth>
          }
        />
        <Route
          path="/athletes/:id"
          element={
            <RequireAuth>
              <AthleteProfile />
            </RequireAuth>
          }
        />
        <Route
          path="/athletes/add"
          element={
            <RequireAuth>
              <RequireRoles roles={["coach", "admin"]}>
                <AddAthletePage />
              </RequireRoles>
            </RequireAuth>
          }
        />
        <Route
          path="/athletes/edit/:id"
          element={
            <RequireAuth>
              <RequireRoles roles={["coach", "admin"]}>
                <EditAthletePage />
              </RequireRoles>
            </RequireAuth>
          }
        />
      </Route>
      {/* Fallback Route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
