import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';

// Page Imports
import Login from './pages/Login';
import Register from './pages/Register';
import Unauthorized from './pages/Unauthorized';
import AthleteDashboard from './pages/AthleteDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AthletesPage from './pages/AthletesPage';
import AthleteProfile from './pages/AthleteProfile';
import AddAthletePage from './pages/AddAthletePage'; // New Import

// Component for shared layout
const ProtectedRouteLayout: React.FC = () => {
  return (
    <>
      <Navbar />
      <div className="container mx-auto p-4">
        <Outlet />
      </div>
    </>
  );
};

// Component to wrap routes inside AuthProvider
const AppWrapper: React.FC = () => {
    const { isAuthenticated, user } = useAuth();

    return (
        <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Role-Based Redirect on Root Path */}
            <Route 
                path="/" 
                element={
                    isAuthenticated && user ? (
                        user.role === 'athlete' ? <Navigate to="/athlete-dashboard" replace /> :
                        user.role === 'coach' ? <Navigate to="/coach-dashboard" replace /> :
                        user.role === 'admin' ? <Navigate to="/admin" replace /> :
                        <Navigate to="/unauthorized" replace />
                    ) : (
                        <Navigate to="/login" replace />
                    )
                } 
            />

            {/* Protected Routes with Navbar Layout */}
            <Route element={<ProtectedRouteLayout />}>
              <Route element={<ProtectedRoute allowedRoles={['athlete']} />}>
                  <Route path="/athlete-dashboard" element={<AthleteDashboard />} />
              </Route>
              
              <Route element={<ProtectedRoute allowedRoles={['coach']} />}>
                  <Route path="/coach-dashboard" element={<CoachDashboard />} />
                  <Route path="/add-athlete" element={<AddAthletePage />} /> {/* New Route */}
              </Route>

              <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                  <Route path="/admin" element={<AdminDashboard />} />
              </Route>

              <Route element={<ProtectedRoute allowedRoles={['admin', 'coach']} />}>
                  <Route path="/athletes" element={<AthletesPage />} />
                  <Route path="/athletes/:id" element={<AthleteProfile />} />
              </Route>
            </Route>

            <Route path="*" element={<h1>404 Not Found</h1>} />
        </Routes>
    );
};

const App: React.FC = () => {
    return (
        <Router>
            <AuthProvider>
                <AppWrapper />
            </AuthProvider>
        </Router>
    );
};

export default App;
