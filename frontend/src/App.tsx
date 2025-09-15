// src/App.tsx

import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import Navbar from "./components/Navbar";
import AthletesPage from "./pages/AthletesPage";
import SessionsPage from "./pages/SessionsPage";
import AttendancePage from "./pages/AttendancePage";
import AssessmentsPage from "./pages/AssessmentsPage";
import InjuriesPage from "./pages/InjuriesPage";
import LoginPage from "./pages/LoginPage";
import PerformancePage from "./pages/PerformancePage";
import Pa360ElevateLandingPage from "./pages/Pa360ElevateLandingPage";

const App = () => {
  return (
    <Router>
      <Navbar />
      <div className="container mx-auto p-4">
        <Routes>
          <Route path="/" element={<Pa360ElevateLandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/elevate" element={<Pa360ElevateLandingPage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/athletes" element={<AthletesPage />} />
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
