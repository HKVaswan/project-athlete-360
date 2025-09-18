import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Unauthorized from './pages/Unauthorized';

// New Dashboard Pages
import AthleteDashboard from './pages/AthleteDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AthletesPage from './pages/AthletesPage';

// A custom component for protecting routes with multiple roles
const ProtectedRoute = ({ allowedRoles, children }: { allowedRoles: string[]; children?: React.ReactNode }) => {
    const { isAuthenticated, user } = useAuth();

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(user?.role)) {
        return <Navigate to="/unauthorized" replace />;
    }

    return children ? children : <Outlet />;
};

const App: React.FC = () => {
    const { isAuthenticated, user } = useAuth();

    return (
        <Router>
            <AuthProvider>
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

                    {/* Protected Routes */}
                    <Route element={<ProtectedRoute allowedRoles={['athlete']} />}>
                        <Route path="/athlete-dashboard" element={<AthleteDashboard />} />
                    </Route>
                    
                    <Route element={<ProtectedRoute allowedRoles={['coach']} />}>
                        <Route path="/coach-dashboard" element={<CoachDashboard />} />
                    </Route>

                    <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                        <Route path="/admin" element={<AdminDashboard />} />
                    </Route>

                    {/* Example of a page for multiple roles */}
                    <Route element={<ProtectedRoute allowedRoles={['admin', 'coach']} />}>
                        <Route path="/athletes" element={<AthletesPage />} />
                    </Route>

                    <Route path="*" element={<h1>404 Not Found</h1>} />
                </Routes>
            </AuthProvider>
        </Router>
    );
};

export default App;
