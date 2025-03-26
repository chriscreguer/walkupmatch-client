import React from 'react';
import { GetServerSideProps } from 'next';
import { getSession } from 'next-auth/react';
import Head from 'next/head';
import Navbar from '@/components/layout/Navbar';
import { TeamProfile } from '@/components/team/TeamProfile';
import BaseballDiamond from '@/components/visualization/BaseballDiamond';
import { TeamPlaylist } from '@/components/team/TeamPlaylist';
import { useTeam } from '@/hooks/useTeam';
import { Team } from '@/lib/mlb/types';

const TeamPage: React.FC = () => {
  const { team, loading, error, refreshTeam } = useTeam();

  return (
    <>
      <Head>
        <title>Your MLB Team | Walkup Match</title>
        <meta name="description" content="Your personalized MLB team based on your Spotify music taste" />
      </Head>

      <Navbar />
      
      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Error message */}
        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded">
            <p>{error}</p>
            <button 
              onClick={refreshTeam}
              className="mt-2 text-sm font-medium text-red-700 hover:text-red-900"
            >
              Try again
            </button>
          </div>
        )}
        
        {/* Team Profile Section */}
        <TeamProfile team={team} loading={loading} />
        
        {/* Baseball Diamond Visualization */}
        <div className="mt-6 bg-[#E4E8E3] bg-opacity-70 p-4 rounded-lg shadow-sm">
          <BaseballDiamond players={team?.players || []} />
        </div>
        
        {/* Team Playlist */}
        <TeamPlaylist team={team} loading={loading} />
      </main>
    </>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);
  
  if (!session) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }
  
  return {
    props: {
      session,
    },
  };
};

export default TeamPage;