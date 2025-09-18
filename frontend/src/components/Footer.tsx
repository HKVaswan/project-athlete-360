import React from 'react';
import { FaHeart } from 'react-icons/fa';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-800 text-white p-4 mt-auto">
      <div className="container mx-auto text-center text-sm">
        <p className="flex items-center justify-center">
          Made with <FaHeart className="text-red-500 mx-1" /> for Sports Science & Physical Education
        </p>
        <p className="mt-2">© 2025 Project Athlete 360. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
