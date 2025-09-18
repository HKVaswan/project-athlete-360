import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar: React.FC = () => {
    const { isAuthenticated, user, logout } = useAuth();

    return (
        <nav className="bg-gray-800 text-white p-4 shadow-md">
            <div className="container mx-auto flex justify-between items-center">
                <Link to="/" className="text-2xl font-bold">
                    SportStack
                </Link>
                <div className="flex items-center space-x-4">
                    {isAuthenticated ? (
                        <>
                            {user?.role === 'coach' && (
                                <Link to="/athletes" className="hover:text-gray-300">
                                    My Athletes
                                </Link>
                            )}
                            {user?.role === 'athlete' && (
                                <Link to="/athlete-dashboard" className="hover:text-gray-300">
                                    Dashboard
                                </Link>
                            )}
                            <button
                                onClick={logout}
                                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login" className="hover:text-gray-300">
                                Login
                            </Link>
                            <Link to="/register" className="hover:text-gray-300">
                                Register
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
