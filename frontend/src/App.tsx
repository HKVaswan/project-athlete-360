import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Components
import Navbar from './components/Navbar';

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

// Main App Component
const App: React.FC = () => {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <Routes>
          {/* All routes are now public and accessible */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/athlete-dashboard" element={<AthleteDashboard />} />
          <Route path="/coach-dashboard" element={<CoachDashboard />} />
          <Route path="/athletes" element={<AthletesPage />} />
          <Route path="/athletes/:id" element={<AthleteProfile />} />
          <Route path="/athletes/add" element={<AddAthletePage />} />
          <Route path="/athletes/edit/:id" element={<EditAthletePage />} />
          <Route path="/admin-dashboard" element={<AdminDashboard />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
