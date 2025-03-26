import React from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Team } from '@/lib/mlb/types';

interface TeamProfileProps {
  team: Team | null;
  loading?: boolean;
}

export function TeamProfile({ team, loading = false }: TeamProfileProps) {
  const { data: session } = useSession();
  const userImage = session?.user?.image || 'https://via.placeholder.com/64';
  const userName = session?.user?.name?.split(' ')[0] || 'User';

  if (loading) {
    return (
      <div className="flex flex-row w-full p-4 bg-white rounded-lg shadow-sm items-center">
        <div className="animate-pulse flex space-x-4 w-full">
          <div className="rounded-full bg-gray-200 h-16 w-16"></div>
          <div className="flex-1 space-y-3 py-1">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="flex space-x-7">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-2 bg-gray-200 rounded w-12"></div>
                  <div className="h-3 bg-gray-200 rounded w-10"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row w-full p-4 bg-white rounded-lg shadow-sm items-center">
      {/* User profile image */}
      <div className="h-16 w-16 rounded-full overflow-hidden mr-4 border-2 border-white shadow">
        <Image 
          src={userImage} 
          alt="User profile" 
          width={64} 
          height={64} 
          className="object-cover w-full h-full"
        />
      </div>
      
      {/* Team info */}
      <div className="flex flex-col">
        <h2 className="font-bold text-lg text-black">
          {team?.name || `${userName}'s Team`}
        </h2>
        
        {/* Stats */}
        <div className="flex flex-row gap-7 mt-1">
          <div className="flex flex-col">
            <span className="text-black text-opacity-70 font-bold uppercase text-xs">W-L</span>
            <span className="text-black font-bold text-base">
              {team ? `${team.stats.wins}-${team.stats.losses}` : '0-0'}
            </span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-black text-opacity-70 font-bold uppercase text-xs">OPS</span>
            <span className="text-black font-bold text-base">
              {team ? team.stats.OPS.toFixed(3) : '.000'}
            </span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-black text-opacity-70 font-bold uppercase text-xs">AVG</span>
            <span className="text-black font-bold text-base">
              {team ? team.stats.AVG.toFixed(3) : '.000'}
            </span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-black text-opacity-70 font-bold uppercase text-xs">ERA</span>
            <span className="text-black font-bold text-base">
              {team ? team.stats.ERA.toFixed(2) : '0.00'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}