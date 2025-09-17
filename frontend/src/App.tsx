// src/App.tsx

import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import Navbar from "./components/Navbar";

// Public Pages
import Pa360ElevateLandingPage from "./pages/Pa360ElevateLandingPage";
import LoginPage from "./pages/LoginPage";
import FeaturesPage from "./pages/FeaturesPage"; 

// Protected Pages
import DashboardPage from "./pages/DashboardPage";
import AthletesPage from "./pages/AthletesPage";
import CreateAthletePage from "./pages/CreateAthletePage";
import SessionsPage from "./pages/SessionsPage";
import AttendancePage from "./pages/AttendancePage";
import AssessmentsPage from "./pages/AssessmentsPage";
import InjuriesPage from "./pages/InjuriesPage";
import PerformancePage from "./pages/PerformancePage";

const App = () => {
  return (
    <Router>
      <Navbar />
      <div className="container mx-auto p-4">
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Pa360ElevateLandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/elevate" element={<Pa360ElevateLandingPage />} />
          
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/athletes" element={<AthletesPage />} />
            <Route path="/create-athlete" element={<CreateAthletePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/attendance/:sessionId" element={<AttendancePage />} />
            <Route path="/assessments" element={<AssessmentsPage />} />
            <Route path="/injuries/:athleteId" element={<InjuriesPage />} />
            <Route path="/athletes/:athleteId/performance" element={<PerformancePage />} />
          </Route>
          
          <Route path="*" element={<div>404 Not Found</div>} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;

