import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

// Components
import Navbar from './components/Navbar';
import Layout from './components/Layout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import AthleteDashboard from './pages/AthleteDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AthletesPage from './pages/AthletesPage';
import AthleteProfile from './pages/AthleteProfile';
import AddAthletePage from './pages/AddAthletePage';
import EditAthletePage from './pages/EditAthletePage';

// Main App Component with AuthProvider
const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
};

// Routes Component to use auth context
const AppRoutes: React.FC = () => {
  const { user } = useAuth();
  
  return (
    <div className="min-h-screen bg-gray-100">
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Home page route to redirect to login if not authenticated */}
        <Route path="/" element={user ? <Navigate to={`/${user.role}-dashboard`} replace /> : <Navigate to="/login" replace />} />
        
        {/* Protected Routes using the new Layout */}
        <Route element={<Layout />}>
          {/* Athlete Routes */}
          <Route path="/athlete-dashboard" element={user && user.role === 'athlete' ? <AthleteDashboard /> : <Navigate to="/login" replace />} />
          
          {/* Coach Routes */}
          <Route path="/coach-dashboard" element={user && user.role === 'coach' ? <CoachDashboard /> : <Navigate to="/login" replace />} />
          <Route path="/athletes" element={user && (user.role === 'coach' || user.role === 'admin') ? <AthletesPage /> : <Navigate to="/login" replace />} />
          <Route path="/athletes/:id" element={user ? <AthleteProfile /> : <Navigate to="/login" replace />} />
          <Route path="/athletes/add" element={user && (user.role === 'coach' || user.role === 'admin') ? <AddAthletePage /> : <Navigate to="/login" replace />} />
          <Route path="/athletes/edit/:id" element={user && (user.role === 'coach' || user.role === 'admin') ? <EditAthletePage /> : <Navigate to="/login" replace />} />

          {/* Admin Routes */}
          <Route path="/admin-dashboard" element={user && user.role === 'admin' ? <AdminDashboard /> : <Navigate to="/login" replace />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
