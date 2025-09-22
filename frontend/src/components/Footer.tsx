// src/components/Footer.tsx
import React from 'react';
import { FaHeart } from 'react-icons/fa';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-800 text-white py-4 mt-auto">
      <div className="container mx-auto text-center text-sm space-y-1">
        <p className="flex items-center justify-center gap-1">
          Made with <FaHeart className="text-red-500" /> for Sports Science & Physical Education
        </p>
        <p>© {currentYear} Project Athlete 360. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;