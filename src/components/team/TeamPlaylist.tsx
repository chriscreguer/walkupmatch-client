import React from 'react';
import Image from 'next/image';
import { Team, Player } from '@/lib/mlb/types';

interface TeamPlaylistProps {
  team: Team | null;
  loading?: boolean;
}

// Helper to find a player by ID
const findPlayerById = (players: Player[], id: string): Player | undefined => {
  return players.find(player => player.id === id);
};

// Helper to render match strength as dots
const MatchScore = ({ score }: { score: number }) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3].map((i) => (
        <div 
          key={i}
          className={`w-2 h-2 rounded-full ${i <= score ? 'bg-green-500' : 'bg-gray-200'}`}
        />
      ))}
    </div>
  );
};

export function TeamPlaylist({ team, loading = false }: TeamPlaylistProps) {
  if (loading) {
    return (
      <div className="w-full mt-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-base text-black">Team Playlist</h3>
          <button className="text-sm text-gray-600 opacity-50" disabled>Open in Spotify</button>
        </div>
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="animate-pulse p-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex space-x-4">
                <div className="rounded bg-gray-200 h-14 w-14"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-2 bg-gray-200 rounded w-1/2"></div>
                </div>
                <div className="w-16">
                  <div className="h-3 bg-gray-200 rounded"></div>
                </div>
                <div className="w-16">
                  <div className="h-2 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!team || !team.songs || team.songs.length === 0) {
    return (
      <div className="w-full mt-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-base text-black">Team Playlist</h3>
          <button className="text-sm text-gray-600 opacity-50" disabled>Open in Spotify</button>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-gray-500 text-center py-4">
            No songs available for this team yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mt-6">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-base text-black">Team Playlist</h3>
        <button className="text-sm text-blue-600 hover:text-blue-800">
          Open in Spotify
        </button>
      </div>
      
      {/* Table Header */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100">
          <div className="flex text-xs font-bold text-black text-opacity-70 uppercase">
            <div className="flex-1">Song</div>
            <div className="w-32">Player</div>
            <div className="w-16 text-center">Match</div>
          </div>
        </div>
        
        {/* Playlist Items */}
        <div className="divide-y divide-gray-100">
          {team.songs.map((song) => {
            const player = findPlayerById(team.players, song.playerMatch);
            
            return (
              <div key={song.id} className="flex p-3 items-center">
                {/* Song Info */}
                <div className="flex flex-1 items-center">
                  <div className="w-14 h-14 rounded overflow-hidden mr-3">
                    <Image 
                      src={song.albumArt} 
                      alt={song.name} 
                      width={56} 
                      height={56} 
                      className="object-cover w-full h-full"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-black font-medium">{song.name}</span>
                    <span className="text-black text-opacity-70 text-sm">{song.artist}</span>
                  </div>
                </div>
                
                {/* Player Info */}
                <div className="w-32">
                  {player && (
                    <div className="flex flex-col">
                      <span className="text-black text-opacity-70 font-bold uppercase text-xs">
                        {player.position}
                      </span>
                      <span className="text-black text-sm">{player.name}</span>
                      <span className="text-black text-opacity-70 text-xs">{player.team}</span>
                    </div>
                  )}
                </div>
                
                {/* Match Score */}
                <div className="w-16 flex justify-center">
                  <MatchScore score={song.matchScore} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}