import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Navbar from '../../components/layout/Navbar';
import TeamProfile from '../../components/team/TeamProfile';
import BaseballDiamond from '../../components/visualization/BaseballDiamond';
import TeamPlaylist from '../../components/team/TeamPlaylist';
import { MLBPlayer } from '../../lib/mlb/types';

declare module "next-auth" {
  interface User {
    id: string;
  }
  interface Session {
    user: User;
  }
}

export default function TeamPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [team, setTeam] = useState<MLBPlayer[]>([]);
  const [teamStats, setTeamStats] = useState({
    wins: 0,
    losses: 0,
    ops: 0,
    avg: 0,
    era: 0,
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      // Fetch team data
      const generateTeam = async () => {
        try {
          const response = await fetch('/api/team/generate');
          if (!response.ok) throw new Error('Failed to generate team');
          
          const data = await response.json();
          setTeam(data.team);
          setTeamStats(data.stats);
          setIsLoading(false);
        } catch (error) {
          console.error('Error generating team:', error);
          setIsLoading(false);
        }
      };

      generateTeam();
    }
  }, [session]);

  if (status === 'loading' || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E5E5E5]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-lg">Building your MLB team based on your music...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E5E5E5]">
      <Head>
        <title>Your MLB Music Match Team</title>
      </Head>
      
      <Navbar />
      
      <main className="container mx-auto px-4 py-6">
        {team.length > 0 && (
          <>
            <TeamProfile 
              userProfile={session?.user} 
              stats={teamStats} 
            />
            
            <div className="mt-8">
              <BaseballDiamond players={team} />
            </div>
            
            <div className="mt-8">
              <TeamPlaylist players={team} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}