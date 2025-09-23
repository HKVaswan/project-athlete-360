// src/App.tsx
import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import Pa360ElevateLandingPage from './pages/Pa360ElevateLandingPage';
import Unauthorized from './pages/Unauthorized';
import CreateAdmin from './pages/CreateAdmin';
import AdminDashboard from './pages/AdminDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AthleteDashboard from './pages/AthleteDashboard';
import AthletesPage from './pages/AthletesPage';
import AddAthletePage from './pages/AddAthletePage';
import EditAthletePage from './pages/EditAthletePage';
import AthleteProfile from './pages/AthleteProfile';
import AllUsers from './pages/AllUsers';
import FeaturesPage from './pages/FeaturesPage';
import SessionsPage from './pages/SessionsPage';
import TrainingSessionsPage from './pages/TrainingSessionsPage';
import TrainingPlans from './pages/TrainingPlans';
import PerformancePage from './pages/PerformancePage'; // <-- Added missing import

// Lazy-loaded pages
const Analytics = lazy(() => import('./pages/Analytics'));
const AssessmentsPage = lazy(() => import('./pages/AssessmentsPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const InjuriesPage = lazy(() => import('./pages/InjuriesPage'));

// Role-based route wrapper
const RequireRole = ({
  roles,
  children,
}: {
  roles: string[];
  children: JSX.Element;
}) => {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!roles.includes(user?.role || '')) return <Navigate to="/" replace />;
  return children;
};

const App: React.FC = () => {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  const getDashboardRoute = () => {
    if (!isAuthenticated) return '/login';
    switch (user?.role) {
      case 'admin':
        return '/admin-dashboard';
      case 'coach':
        return '/coach-dashboard';
      case 'athlete':
        return '/athlete-dashboard';
      default:
        return '/login';
    }
  };

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={getDashboardRoute()} replace /> : <Login />}
      />
      <Route path="/register" element={<Register />} />
      <Route path="/pa360" element={<Pa360ElevateLandingPage />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/create-admin" element={<CreateAdmin />} /> {/* Temporary */}

      {/* Authenticated routes */}
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={getDashboardRoute()} replace />} />

        {/* Dashboards */}
        <Route
          path="/admin-dashboard"
          element={
            <RequireRole roles={['admin']}>
              <AdminDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/coach-dashboard"
          element={
            <RequireRole roles={['coach']}>
              <CoachDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/athlete-dashboard"
          element={
            <RequireRole roles={['athlete']}>
              <AthleteDashboard />
            </RequireRole>
          }
        />

        {/* Admin / Coach pages */}
        <Route
          path="/athletes"
          element={
            <RequireRole roles={['admin', 'coach']}>
              <AthletesPage />
            </RequireRole>
          }
        />
        <Route
          path="/add-athlete"
          element={
            <RequireRole roles={['admin']}>
              <AddAthletePage />
            </RequireRole>
          }
        />
        <Route
          path="/edit-athlete/:id"
          element={
            <RequireRole roles={['admin']}>
              <EditAthletePage />
            </RequireRole>
          }
        />
        <Route path="/athlete-profile/:id" element={<AthleteProfile />} />
        <Route
          path="/users"
          element={
            <RequireRole roles={['admin']}>
              <AllUsers />
            </RequireRole>
          }
        />
        <Route
          path="/analytics"
          element={
            <RequireRole roles={['admin', 'coach']}>
              <Suspense fallback={<div>Loading Analytics...</div>}>
                <Analytics />
              </Suspense>
            </RequireRole>
          }
        />

        {/* Athlete-specific pages */}
        <Route
          path="/performance"
          element={
            <RequireRole roles={['athlete']}>
              <PerformancePage />
            </RequireRole>
          }
        />
        <Route
          path="/training"
          element={
            <RequireRole roles={['athlete']}>
              <TrainingPlans />
            </RequireRole>
          }
        />
        <Route
          path="/training-sessions"
          element={
            <RequireRole roles={['athlete']}>
              <TrainingSessionsPage />
            </RequireRole>
          }
        />

        {/* Shared pages */}
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/features" element={<FeaturesPage />} />

        {/* Lazy-loaded shared pages */}
        <Route
          path="/assessments"
          element={
            <Suspense fallback={<div>Loading Assessments...</div>}>
              <AssessmentsPage />
            </Suspense>
          }
        />
        <Route
          path="/attendance"
          element={
            <Suspense fallback={<div>Loading Attendance...</div>}>
              <AttendancePage />
            </Suspense>
          }
        />
        <Route
          path="/injuries"
          element={
            <Suspense fallback={<div>Loading Injuries...</div>}>
              <InjuriesPage />
            </Suspense>
          }
        />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to={getDashboardRoute()} replace />} />
    </Routes>
  );
};

export default App;