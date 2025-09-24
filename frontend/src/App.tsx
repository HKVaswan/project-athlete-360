// src/App.tsx
import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import RouteErrorBoundary from './components/RouteErrorBoundary'; // ✅ Import

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
import PerformancePage from './pages/PerformancePage';

// Lazy-loaded pages
const Analytics = lazy(() => import('./pages/Analytics'));
const AssessmentsPage = lazy(() => import('./pages/AssessmentsPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const InjuriesPage = lazy(() => import('./pages/InjuriesPage'));

// ✅ Role-based route wrapper
const RequireRole = ({
  roles,
  children,
}: {
  roles: string[];
  children: JSX.Element;
}) => {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!roles.includes(user?.role || '')) return <Navigate to="/unauthorized" replace />;
  return children;
};

const App: React.FC = () => {
  const { isAuthenticated, user } = useAuth();

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
      <Route path="/create-admin" element={<CreateAdmin />} />

      {/* Routes wrapped with Layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Pa360ElevateLandingPage />} />

        {/* Dashboards with error isolation */}
        <Route
          path="/admin-dashboard"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin']}>
                <AdminDashboard />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/coach-dashboard"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['coach']}>
                <CoachDashboard />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/athlete-dashboard"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['athlete']}>
                <AthleteDashboard />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />

        {/* Admin / Coach pages */}
        <Route
          path="/athletes"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin', 'coach']}>
                <AthletesPage />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/add-athlete"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin']}>
                <AddAthletePage />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/edit-athlete/:id"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin']}>
                <EditAthletePage />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/users"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin']}>
                <AllUsers />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />

        {/* Analytics (lazy + risky) */}
        <Route
          path="/analytics"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['admin', 'coach']}>
                <Suspense fallback={<div>Loading Analytics...</div>}>
                  <Analytics />
                </Suspense>
              </RequireRole>
            </RouteErrorBoundary>
          }
        />

        {/* Athlete pages */}
        <Route
          path="/performance"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['athlete']}>
                <PerformancePage />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/training"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['athlete']}>
                <TrainingPlans />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/training-sessions"
          element={
            <RouteErrorBoundary>
              <RequireRole roles={['athlete']}>
                <TrainingSessionsPage />
              </RequireRole>
            </RouteErrorBoundary>
          }
        />

        {/* Shared pages */}
        <Route path="/sessions" element={<RouteErrorBoundary><SessionsPage /></RouteErrorBoundary>} />
        <Route path="/profile" element={<RouteErrorBoundary><ProfilePage /></RouteErrorBoundary>} />
        <Route path="/settings" element={<RouteErrorBoundary><SettingsPage /></RouteErrorBoundary>} />
        <Route path="/features" element={<RouteErrorBoundary><FeaturesPage /></RouteErrorBoundary>} />

        {/* Lazy-loaded shared pages */}
        <Route
          path="/assessments"
          element={
            <RouteErrorBoundary>
              <Suspense fallback={<div>Loading Assessments...</div>}>
                <AssessmentsPage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/attendance"
          element={
            <RouteErrorBoundary>
              <Suspense fallback={<div>Loading Attendance...</div>}>
                <AttendancePage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/injuries"
          element={
            <RouteErrorBoundary>
              <Suspense fallback={<div>Loading Injuries...</div>}>
                <InjuriesPage />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;