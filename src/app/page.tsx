'use client';

import Image from 'next/image';
import { FaSpotify } from 'react-icons/fa';
import { useSpotifyAuth } from '@/lib/auth/authUtils';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LandingPage() {
  const { isAuthenticated, loginWithSpotify } = useSpotifyAuth();
  const router = useRouter();
  
  // If user is already authenticated, redirect to team page
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/team');
    }
  }, [isAuthenticated, router]);

  return (
    <main className="flex flex-col min-h-screen bg-[#E5E5E5]">
      {/* Main content section */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Preview UI Graphic - Replace with your actual image */}
        <div className="w-full max-w-md mb-8">
          <Image
            src="/images/preview-ui.png"
            alt="WalkUp Match App Preview"
            width={500}
            height={400}
            className="w-full h-auto rounded-lg"
            priority
          />
        </div>
      </div>

      {/* CTA Section (Bottom) */}
      <div className="w-full bg-white py-10 px-6 rounded-t-3xl ">
        <div className="max-w-md mx-auto">
          {/* Headline */}
          <h1 className="font-dm-sans text-3xl font-bold text-black mb-3">
            Match Your Music with the Pros&apos;
          </h1>
          
          {/* Subheading */}
          <p className="text-lg text-gray-700 mb-8">
            Assemble an MLB team based on your music taste.
          </p>
          
          {/* Login Button */}
          <button
            onClick={loginWithSpotify}
            className="flex items-center justify-center w-full bg-[#1DB954] text-white font-medium py-3 px-6 rounded-full hover:bg-opacity-90 transition duration-200"
          >
            <FaSpotify className="mr-2 text-xl" />
            Login with Spotify
          </button>
        </div>
      </div>
    </main>
  );
}