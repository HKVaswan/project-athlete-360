import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AthletesPage from './pages/AthletesPage';
import CreateAthletePage from './pages/CreateAthletePage';
import TrainingSessionsPage from './pages/TrainingSessionsPage';
import { AuthContext } from './AuthContext';

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated }}>
      <Router>
        <nav className="bg-blue-800 p-4 shadow-md">
          <ul className="flex justify-start space-x-4 text-white">
            <li>
              <Link to="/dashboard" className="hover:text-blue-200">Dashboard</Link>
            </li>
            <li>
              <Link to="/athletes" className="hover:text-blue-200">Athletes</Link>
            </li>
            <li>
              <Link to="/create-athlete" className="hover:text-blue-200">Create Athlete</Link>
            </li>
            <li className="ml-auto">
              {!isAuthenticated ? (
                <Link to="/" className="hover:text-blue-200">Login</Link>
              ) : (
                <button
                  onClick={() => {
                    localStorage.removeItem('token');
                    setIsAuthenticated(false);
                    // navigate('/'); // You can add navigation logic here
                  }}
                  className="hover:text-blue-200"
                >
                  Logout
                </button>
              )}
            </li>
          </ul>
        </nav>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/athletes" element={<AthletesPage />} />
          <Route path="/create-athlete" element={<CreateAthletePage />} />
          <Route path="/athletes/sessions/:athleteId" element={<TrainingSessionsPage />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
};

export default App; 

