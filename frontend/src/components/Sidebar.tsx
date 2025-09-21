import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './../context/AuthContext';
import {
  FaTachometerAlt,
  FaUsers,
  FaUser,
  FaPlusCircle,
  FaChartLine,
  FaRunning,
  FaSignOutAlt,
  FaTimes,
  FaChevronCircleLeft,
} from 'react-icons/fa';

// Define the navigation links for each role
const navigation = {
  admin: [
    { name: 'Admin Dashboard', href: '/admin-dashboard', icon: FaTachometerAlt },
    { name: 'View Athletes', href: '/athletes', icon: FaRunning },
    { name: 'Add Athlete', href: '/athletes/add', icon: FaPlusCircle },
    { name: 'View All Users', href: '/users', icon: FaUsers },
  ],
  coach: [
    { name: 'Coach Dashboard', href: '/coach-dashboard', icon: FaTachometerAlt },
    { name: 'My Athletes', href: '/athletes', icon: FaRunning },
    { name: 'Add Athlete', href: '/athletes/add', icon: FaPlusCircle },
    { name: 'View Profile', href: '/profile', icon: FaUser },
    { name: 'Analytics', href: '/analytics', icon: FaChartLine },
  ],
  athlete: [
    { name: 'Athlete Dashboard', href: '/athlete-dashboard', icon: FaTachometerAlt },
    { name: 'My Profile', href: '/profile', icon: FaUser },
    { name: 'Performance Metrics', href: '/performance', icon: FaChartLine },
    { name: 'Training Plans', href: '/training', icon: FaRunning },
  ],
};

interface SidebarProps {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isSidebarOpen, toggleSidebar }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (!user) {
    return null; // Don't render sidebar if no user is logged in
  }

  const roleNav = navigation[user.role as keyof typeof navigation];

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-gray-600 bg-opacity-75 transition-opacity md:hidden ${
          isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggleSidebar}
      />

      {/* Sidebar Content */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-gray-800 text-white transform transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 p-4 border-b border-gray-700">
          <Link to="/" className="text-xl font-bold flex items-center">
            <FaChevronCircleLeft className="mr-2 text-blue-400" />
            Project A-360
          </Link>
          <button
            onClick={toggleSidebar}
            className="md:hidden text-gray-400 hover:text-white"
            aria-label="Close sidebar"
          >
            <FaTimes size={20} />
          </button>
        </div>

        {/* Profile Section */}
        <div className="p-4 border-b border-gray-700 text-center">
          <FaUser className="mx-auto w-12 h-12 text-gray-400 mb-2" />
          <h3 className="text-lg font-semibold capitalize">{user.role}</h3>
          <p className="text-sm text-gray-400">{user.username}</p>
        </div>

        {/* Navigation Links */}
        <nav className="flex-grow p-4 space-y-2">
          {roleNav.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              onClick={toggleSidebar}
              className={`flex items-center space-x-3 p-2 rounded-md transition-colors duration-200 ${
                location.pathname === item.href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <item.icon className="text-xl" />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center space-x-3 p-2 rounded-md text-red-400 hover:bg-red-900 transition-colors"
          >
            <FaSignOutAlt className="text-xl" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
