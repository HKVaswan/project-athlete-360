import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaBars, FaTimes, FaRunning, FaUser, FaSignOutAlt, FaTachometerAlt, FaUsers, FaUserPlus, FaUserEdit } from 'react-icons/fa';

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center space-x-1 px-3 py-2 rounded-md transition-colors ${
      isActive ? 'bg-gray-700 text-yellow-400 font-semibold' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center space-x-2 w-full px-4 py-3 text-lg transition-colors border-b border-gray-700 last:border-b-0 ${
      isActive ? 'bg-gray-700 text-yellow-400 font-semibold' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`;
  
  return (
    <nav className="bg-gray-800 text-white p-4 shadow-lg sticky top-0 z-50">
      <div className="container mx-auto flex justify-between items-center">
        <NavLink to="/" className="flex items-center space-x-2 text-xl font-bold text-white hover:text-gray-300 transition-colors">
          <FaRunning />
          <span>ProTrainer</span>
        </NavLink>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center space-x-4">
          {user ? (
            <>
              {user.role === 'admin' && (
                <NavLink to="/admin-dashboard" className={linkClass}>
                  <FaTachometerAlt />
                  <span>Admin</span>
                </NavLink>
              )}
              {(user.role === 'coach' || user.role === 'admin') && (
                <NavLink to="/athletes" className={linkClass}>
                  <FaUsers />
                  <span>Athletes</span>
                </NavLink>
              )}
              {user.role === 'coach' && (
                <NavLink to="/coach-dashboard" className={linkClass}>
                  <FaTachometerAlt />
                  <span>Coach</span>
                </NavLink>
              )}
              {user.role === 'athlete' && (
                <NavLink to="/athlete-dashboard" className={linkClass}>
                  <FaTachometerAlt />
                  <span>My Dashboard</span>
                </NavLink>
              )}
              <div className="flex items-center space-x-2 ml-4 text-gray-400">
                <FaUser />
                <span className="font-semibold">{user.username}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 bg-red-600 hover:bg-red-700 transition-colors py-2 px-3 rounded-md"
              >
                <FaSignOutAlt />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <NavLink to="/login" className={linkClass}>Login</NavLink>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center">
          <button onClick={() => setIsOpen(!isOpen)} className="text-gray-300 hover:text-white focus:outline-none">
            {isOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <div className={`md:hidden ${isOpen ? 'block' : 'hidden'} absolute top-16 left-0 w-full bg-gray-800 shadow-lg`}>
        <div className="flex flex-col items-start pt-2 pb-3 space-y-1">
          {user && (
            <div className="flex items-center space-x-2 px-4 py-2 text-gray-400 border-b border-gray-700 w-full">
              <FaUser />
              <span className="font-semibold">{user.username}</span>
            </div>
          )}
          {user ? (
            <>
              {user.role === 'admin' && (
                <NavLink to="/admin-dashboard" className={mobileLinkClass} onClick={() => setIsOpen(false)}>
                  <FaTachometerAlt />
                  <span>Admin Dashboard</span>
                </NavLink>
              )}
              {(user.role === 'coach' || user.role === 'admin') && (
                <NavLink to="/athletes" className={mobileLinkClass} onClick={() => setIsOpen(false)}>
                  <FaUsers />
                  <span>Athletes</span>
                </NavLink>
              )}
              {user.role === 'coach' && (
                <NavLink to="/coach-dashboard" className={mobileLinkClass} onClick={() => setIsOpen(false)}>
                  <FaTachometerAlt />
                  <span>Coach Dashboard</span>
                </NavLink>
              )}
              {user.role === 'athlete' && (
                <NavLink to="/athlete-dashboard" className={mobileLinkClass} onClick={() => setIsOpen(false)}>
                  <FaTachometerAlt />
                  <span>My Dashboard</span>
                </NavLink>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white text-left transition-colors"
              >
                <FaSignOutAlt />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <NavLink to="/login" className={mobileLinkClass} onClick={() => setIsOpen(false)}>Login</NavLink>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;  
