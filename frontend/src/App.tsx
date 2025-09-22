import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';

// Import all your dashboard pages here
import AdminDashboard from './pages/AdminDashboard';
import Athletes from './pages/Athletes';
import AllUsers from './pages/AllUsers';
import CoachDashboard from './pages/CoachDashboard';
import AthleteDashboard from './pages/AthleteDashboard';
import Profile from './pages/Profile';
import Analytics from './pages/Analytics';
import Performance from './pages/Performance';
import TrainingPlans from './pages/TrainingPlans';

function App() {
  const { isAuthenticated, loading, user } = useAuth();
  
  // Conditionally render based on authentication loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  
  // A helper component to check for a required role
  const RequireRole = ({ role, children }: { role: string; children: JSX.Element }) => {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />;
    }
    if (user?.role !== role) {
      return <Navigate to="/dashboard" replace />;
    }
    return children;
  };

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={<Register />} />
      
      {/*
        The main dashboard layout. All authenticated pages will be children of this route.
        The layout itself handles the logic of showing a full-screen loading spinner
        or redirecting to public routes if not authenticated.
      */}
      <Route element={<Layout />}>
        {/* Redirect from root to dashboard */}
        <Route path="/" element={<Navigate to={isAuthenticated ? (user?.role === 'admin' ? '/admin-dashboard' : (user?.role === 'coach' ? '/coach-dashboard' : '/athlete-dashboard')) : "/login"} replace />} />

        {/* Dashboard routes by role */}
        <Route path="/admin-dashboard" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
        <Route path="/coach-dashboard" element={<RequireRole role="coach"><CoachDashboard /></RequireRole>} />
        <Route path="/athlete-dashboard" element={<RequireRole role="athlete"><AthleteDashboard /></RequireRole>} />

        {/* Shared and specific routes */}
        <Route path="/athletes" element={isAuthenticated && (user?.role === 'admin' || user?.role === 'coach') ? <Athletes /> : <Navigate to="/dashboard" />} />
        <Route path="/users" element={isAuthenticated && user?.role === 'admin' ? <AllUsers /> : <Navigate to="/dashboard" />} />
        <Route path="/profile" element={isAuthenticated ? <Profile /> : <Navigate to="/login" />} />
        <Route path="/analytics" element={isAuthenticated && (user?.role === 'admin' || user?.role === 'coach') ? <Analytics /> : <Navigate to="/dashboard" />} />
        <Route path="/performance" element={isAuthenticated && user?.role === 'athlete' ? <Performance /> : <Navigate to="/dashboard" />} />
        <Route path="/training" element={isAuthenticated && user?.role === 'athlete' ? <TrainingPlans /> : <Navigate to="/dashboard" />} />
      </Route>
      
      {/* Catch-all for undefined routes */}
      <Route path="*" element={<Navigate to={isAuthenticated ? (user?.role === 'admin' ? '/admin-dashboard' : (user?.role === 'coach' ? '/coach-dashboard' : '/athlete-dashboard')) : "/login"} replace />} />
    </Routes>
  );
}

export default App;
