'use client';

import { useSpotifyAuth } from '@/lib/auth/authUtils';
import Link from 'next/link';
import { FaSignOutAlt } from 'react-icons/fa';

export default function Navbar() {
  const { logout } = useSpotifyAuth();

  return (
    <header className="bg-gray-800 text-white">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center">
          <Link href="/" className="font-bold text-xl">
            WalkUp Match
          </Link>
        </div>
        
        <nav>
          <button 
            onClick={logout}
            className="flex items-center text-sm text-white hover:text-gray-300 transition"
            aria-label="Sign out"
          >
            <FaSignOutAlt className="mr-1" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </nav>
      </div>
    </header>
  );
}