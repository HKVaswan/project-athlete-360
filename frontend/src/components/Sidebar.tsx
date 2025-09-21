import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './../context/AuthContext';
import { useTheme } from './../context/ThemeContext'; // <-- Import the new hook
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
  FaMoon,
  FaSun,
  FaBell,
  FaSearch,
  FaChevronDown,
  FaChevronUp
} from 'react-icons/fa';
import classNames from 'classnames';

type Role = 'admin' | 'coach' | 'athlete';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{className?: string}>;
  badge?: number;
  group?: string;
}

const navigation: Record<Role, NavItem[]> = {
  admin: [
    { name: 'Dashboard', href: '/admin-dashboard', icon: FaTachometerAlt, group: 'Main' },
    { name: 'View Athletes', href: '/athletes', icon: FaRunning, group: 'Athletes', badge: 3 },
    { name: 'Add Athlete', href: '/athletes/add', icon: FaPlusCircle, group: 'Athletes' },
    { name: 'View All Users', href: '/users', icon: FaUsers, group: 'Users' },
  ],
  coach: [
    { name: 'Dashboard', href: '/coach-dashboard', icon: FaTachometerAlt, group: 'Main' },
    { name: 'My Athletes', href: '/athletes', icon: FaRunning, group: 'Athletes' },
    { name: 'Add Athlete', href: '/athletes/add', icon: FaPlusCircle, group: 'Athletes' },
    { name: 'Profile', href: '/profile', icon: FaUser, group: 'Main' },
    { name: 'Analytics', href: '/analytics', icon: FaChartLine, group: 'Main', badge: 1 },
  ],
  athlete: [
    { name: 'Dashboard', href: '/athlete-dashboard', icon: FaTachometerAlt, group: 'Main' },
    { name: 'My Profile', href: '/profile', icon: FaUser, group: 'Main' },
    { name: 'Performance Metrics', href: '/performance', icon: FaChartLine, group: 'Performance' },
    { name: 'Training Plans', href: '/training', icon: FaRunning, group: 'Performance' },
  ],
};

interface SidebarProps {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

const getInitials = (name?: string) => {
  if (!name) return 'U';
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
};

const LinkItem: React.FC<{
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}> = ({ item, active, onClick }) => (
  <Link
    to={item.href}
    onClick={onClick}
    className={classNames(
      'flex items-center space-x-3 p-2 rounded-md transition-colors duration-200 outline-none focus:ring-2 focus:ring-blue-400',
      {
        'bg-blue-600 text-white': active,
        'text-gray-300 hover:bg-gray-700 hover:text-white': !active,
      }
    )}
    tabIndex={0}
    aria-current={active ? 'page' : undefined}
  >
    <item.icon className="text-xl" />
    <span>{item.name}</span>
    {item.badge && (
      <span className="ml-auto bg-red-500 text-white rounded-full px-2 text-xs">{item.badge}</span>
    )}
  </Link>
);

const groupNavItems = (items: NavItem[]) => {
  const groups: Record<string, NavItem[]> = {};
  items.forEach(item => {
    if (!groups[item.group || 'Other']) groups[item.group || 'Other'] = [];
    groups[item.group || 'Other'].push(item);
  });
  return groups;
};

const Sidebar: React.FC<SidebarProps> = ({ isSidebarOpen, toggleSidebar }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme(); // <-- Use the global theme hook
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<{ [key: string]: boolean }>({});

  if (!user) return null;

  const roleNav = navigation[user.role as Role] || [];
  const groupedNav = groupNavItems(roleNav);

  const filteredGroupedNav = search
    ? Object.fromEntries(
        Object.entries(groupedNav)
          .map(([group, items]) => [
            group,
            items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
          ])
          .filter(([, items]) => items.length > 0)
      )
    : groupedNav;

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={classNames(
          'fixed inset-0 z-40 bg-gray-900 bg-opacity-75 transition-opacity md:hidden',
          {
            'opacity-100 pointer-events-auto': isSidebarOpen,
            'opacity-0 pointer-events-none': !isSidebarOpen,
          }
        )}
        onClick={toggleSidebar}
        aria-hidden={!isSidebarOpen}
      />

      {/* Sidebar Drawer */}
      <aside
        className={classNames(
          `${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} fixed inset-y-0 left-0 z-50 flex flex-col w-72 shadow-lg transform transition-transform duration-300 ease-in-out`,
          {
            'translate-x-0': isSidebarOpen,
            '-translate-x-full md:translate-x-0': !isSidebarOpen,
          }
        )}
        aria-label="Sidebar"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 p-4 border-b border-gray-700">
          <Link to="/" className="text-xl font-bold flex items-center">
            <FaChevronCircleLeft className="mr-2 text-blue-400" />
            Project A-360
          </Link>
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleTheme} // <-- Use the new global toggleTheme function
              className="text-gray-400 hover:text-yellow-400 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <FaSun size={20} /> : <FaMoon size={20} />}
            </button>
            <button
              onClick={toggleSidebar}
              className="md:hidden text-gray-400 hover:text-white"
              aria-label="Close sidebar"
            >
              <FaTimes size={20} />
            </button>
          </div>
        </div>

        {/* Profile */}
        <div className="p-4 border-b border-gray-700 flex flex-col items-center">
          {/* Avatar or initials */}
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="w-14 h-14 rounded-full mb-2 shadow"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold mb-2 shadow">
              {getInitials(user.username)}
            </div>
          )}
          <h3 className="text-lg font-semibold capitalize">{user.role}</h3>
          <p className="text-sm text-gray-400">{user.username}</p>
          {/* Example notification bell */}
          <button className="mt-2 text-gray-400 hover:text-red-400 relative" aria-label="Notifications">
            <FaBell />
            <span className="absolute -top-1 -right-2 bg-red-500 text-white rounded-full px-1 text-xs">2</span>
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center bg-gray-700 rounded-md px-2 py-1">
            <FaSearch className="text-gray-400 mr-2" />
            <input
              className="bg-transparent focus:outline-none text-white w-full"
              type="text"
              placeholder="Search menu..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Sidebar search"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-grow p-4 space-y-4 overflow-y-auto" role="navigation">
          {Object.entries(filteredGroupedNav).map(([group, items]) => (
            <div key={group}>
              <button
                className="w-full flex justify-between items-center text-xs uppercase font-bold tracking-wide mb-2 text-gray-400 hover:text-white focus:outline-none"
                onClick={() => setCollapsed(c => ({ ...c, [group]: !c[group] }))}
                aria-expanded={!collapsed[group]}
                aria-controls={`group-${group}`}
              >
                {group}
                {collapsed[group] ? <FaChevronDown /> : <FaChevronUp />}
              </button>
              <div id={`group-${group}`} className={collapsed[group] ? 'hidden' : ''}>
                {items.map(item => (
                  <LinkItem
                    key={item.name}
                    item={item}
                    active={location.pathname === item.href}
                    onClick={toggleSidebar}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center space-x-3 p-2 rounded-md text-red-400 hover:bg-red-900 transition-colors outline-none focus:ring-2 focus:ring-red-400"
          >
            <FaSignOutAlt className="text-xl" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
 