import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './../context/AuthContext';
import { useTheme } from './../context/ThemeContext';
import {
  FaBars,
  FaTimes,
  FaSignOutAlt,
  FaSun,
  FaMoon,
  FaRunning
} from 'react-icons/fa';
import classNames from 'classnames';

// Use the same navigation data structure from Sidebar.tsx
const navigation = {
  admin: [
    { name: 'Dashboard', href: '/admin-dashboard' },
    { name: 'Athletes', href: '/athletes' },
    { name: 'Users', href: '/users' },
  ],
  coach: [
    { name: 'Dashboard', href: '/coach-dashboard' },
    { name: 'My Athletes', href: '/athletes' },
    { name: 'Analytics', href: '/analytics' },
  ],
  athlete: [
    { name: 'Dashboard', href: '/athlete-dashboard' },
    { name: 'My Profile', href: '/profile' },
  ],
};

interface NavbarProps {
  toggleSidebar: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ toggleSidebar }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    classNames(
      'flex items-center space-x-1 px-3 py-2 rounded-md transition-colors',
      {
        'bg-blue-600 text-white font-semibold': isActive,
        'text-gray-300 hover:bg-gray-700 hover:text-white': !isActive,
      }
    );

  const roleNav = user ? navigation[user.role as keyof typeof navigation] : [];
  
  return (
    <nav className="bg-gray-800 text-white p-4 shadow-lg sticky top-0 z-50">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-4">
          {/* Mobile Menu Button - now controls the sidebar */}
          <button onClick={toggleSidebar} className="md:hidden text-gray-300 hover:text-white focus:outline-none" aria-label="Toggle navigation">
            <FaBars size={24} />
          </button>
          <NavLink to="/" className="flex items-center space-x-2 text-xl font-bold text-white hover:text-gray-300 transition-colors">
            <FaRunning />
            <span>ProTrainer</span>
          </NavLink>
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center space-x-4">
          {user ? (
            <>
              {roleNav.map((item) => (
                <NavLink key={item.name} to={item.href} className={linkClass}>
                  <span>{item.name}</span>
                </NavLink>
              ))}
              <div className="flex items-center space-x-2 ml-4 text-gray-400">
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

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="md:hidden text-gray-400 hover:text-yellow-400 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <FaSun size={20} /> : <FaMoon size={20} />}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
