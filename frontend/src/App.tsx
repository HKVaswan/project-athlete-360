// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import AdminDashboard from './pages/AdminDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AthleteDashboard from './pages/AthleteDashboard';
import ProfilePage from './pages/ProfilePage';
import PerformancePage from './pages/PerformancePage';
import TrainingSessionsPage from './pages/TrainingSessionsPage';
import AthletesPage from './pages/AthletesPage';
import AddAthletePage from './pages/AddAthletePage';
import EditAthletePage from './pages/EditAthletePage';
import AthleteProfile from './pages/AthleteProfile';
import AssessmentsPage from './pages/AssessmentsPage';
import AttendancePage from './pages/AttendancePage';
import InjuriesPage from './pages/InjuriesPage';
import FeaturesPage from './pages/FeaturesPage';
import SessionsPage from './pages/SessionsPage';
import SettingsPage from './pages/SettingsPage';
import Pa360ElevateLandingPage from './pages/Pa360ElevateLandingPage';
import Unauthorized from './pages/Unauthorized';
import Athletes from './pages/athletes';
import DashboardPage from './pages/DashboardPage';
import Analytics from './pages/Analytics';
import TrainingPlans from './pages/TrainingPlans';
import CreateAdmin from './pages/CreateAdmin';

function App() {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  const getDashboardRoute = () => {
    if (!isAuthenticated) return "/login";
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

  const RequireRole = ({ role, children }: { role: string; children: JSX.Element }) => {
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    if (user?.role !== role) return <Navigate to={getDashboardRoute()} replace />;
    return children;
  };

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={isAuthenticated ? <Navigate to={getDashboardRoute()} replace /> : <Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/pa360" element={<Pa360ElevateLandingPage />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/create-admin" element={<CreateAdmin />} /> {/* Temporary admin creation */}

      {/* Main authenticated layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={getDashboardRoute()} replace />} />

        {/* Dashboards */}
        <Route path="/admin-dashboard" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
        <Route path="/coach-dashboard" element={<RequireRole role="coach"><CoachDashboard /></RequireRole>} />
        <Route path="/athlete-dashboard" element={<RequireRole role="athlete"><AthleteDashboard /></RequireRole>} />

        {/* Admin/Coach pages */}
        <Route path="/athletes" element={isAuthenticated && (user?.role === 'admin' || user?.role === 'coach') ? <AthletesPage /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/add-athlete" element={isAuthenticated && user?.role === 'admin' ? <AddAthletePage /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/edit-athlete/:id" element={isAuthenticated && user?.role === 'admin' ? <EditAthletePage /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/athlete-profile/:id" element={isAuthenticated ? <AthleteProfile /> : <Navigate to="/login" />} />
        <Route path="/assessments" element={isAuthenticated ? <AssessmentsPage /> : <Navigate to="/login" />} />
        <Route path="/attendance" element={isAuthenticated ? <AttendancePage /> : <Navigate to="/login" />} />
        <Route path="/injuries" element={isAuthenticated ? <InjuriesPage /> : <Navigate to="/login" />} />
        <Route path="/analytics" element={isAuthenticated && (user?.role === 'admin' || user?.role === 'coach') ? <Analytics /> : <Navigate to={getDashboardRoute()} />} />

        {/* Athlete-specific pages */}
        <Route path="/performance" element={isAuthenticated && user?.role === 'athlete' ? <PerformancePage /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/training" element={isAuthenticated && user?.role === 'athlete' ? <TrainingPlans /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/training-sessions" element={isAuthenticated && user?.role === 'athlete' ? <TrainingSessionsPage /> : <Navigate to={getDashboardRoute()} />} />
        <Route path="/sessions" element={isAuthenticated ? <SessionsPage /> : <Navigate to="/login" />} />

        {/* Other shared pages */}
        <Route path="/profile" element={isAuthenticated ? <ProfilePage /> : <Navigate to="/login" />} />
        <Route path="/settings" element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/athletes-list" element={<Athletes />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to={getDashboardRoute()} replace />} />
    </Routes>
  );
}

export default App; 