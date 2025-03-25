import Image from 'next/image';
import { User } from 'next-auth';

interface TeamProfileProps {
  userProfile: User | undefined;
  stats: {
    wins: number;
    losses: number;
    ops: number;
    avg: number;
    era: number;
  };
}

export default function TeamProfile({ userProfile, stats }: TeamProfileProps) {
  if (!userProfile) return null;
  
  const firstName = userProfile.name?.split(' ')[0] || 'Your';
  
  return (
    <div className="flex items-center bg-white rounded-lg p-4 shadow-sm">
      <div className="mr-4">
        {userProfile.image ? (
          <Image 
            src={userProfile.image} 
            alt={userProfile.name || 'User'} 
            width={64} 
            height={64} 
            className="rounded-full border-2 border-gray-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center">
            <span className="text-xl text-gray-600">{firstName[0]}</span>
          </div>
        )}
      </div>
      
      <div>
        <h2 className="text-lg font-bold">{firstName}&apos;s Team</h2>
        
        <div className="flex gap-7 mt-2">
          <div className="text-center">
            <p className="text-xs font-bold uppercase text-black/70">W-L</p>
            <p className="text-base font-bold">{stats.wins}-{stats.losses}</p>
          </div>
          
          <div className="text-center">
            <p className="text-xs font-bold uppercase text-black/70">OPS</p>
            <p className="text-base font-bold">{stats.ops.toFixed(3)}</p>
          </div>
          
          <div className="text-center">
            <p className="text-xs font-bold uppercase text-black/70">AVG</p>
            <p className="text-base font-bold">{stats.avg.toFixed(3)}</p>
          </div>
          
          <div className="text-center">
            <p className="text-xs font-bold uppercase text-black/70">ERA</p>
            <p className="text-base font-bold">{stats.era.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}