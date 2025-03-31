'use client';

import { useSpotifyAuth } from '@/lib/auth/authUtils';
import Link from 'next/link';
import { FaSignOutAlt } from 'react-icons/fa';

export default function Navbar() {
  const { logout } = useSpotifyAuth();

  return (
    <header className="bg-gray-900 text-white border-b border-gray-800">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center">
          <Link href="/" className="font-bold text-xl text-white hover:text-gray-200 transition-colors">
            WalkUp Match
          </Link>
        </div>
        
        <nav>
          <button 
            onClick={logout}
            className="flex items-center text-sm text-gray-300 hover:text-white transition-colors bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-md"
            aria-label="Sign out"
          >
            <FaSignOutAlt className="mr-2" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </nav>
      </div>
    </header>
  );
}