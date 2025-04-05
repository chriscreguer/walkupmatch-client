import React, { useState } from 'react';
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

export function TeamPlaylist({ team, loading = false }: TeamPlaylistProps) {
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const handleAlbumClick = (songId: string, previewUrl?: string) => {
    if (playingAudio === songId) {
      // Stop current audio
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      setPlayingAudio(null);
      setAudioElement(null);
    } else {
      // Stop any currently playing audio
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }

      // Start new audio if preview URL exists
      if (previewUrl) {
        const audio = new Audio(previewUrl);
        audio.onended = () => {
          setPlayingAudio(null);
          setAudioElement(null);
        };
        audio.play();
        setPlayingAudio(songId);
        setAudioElement(audio);
      }
    }
  };

  // Cleanup audio on unmount
  React.useEffect(() => {
    return () => {
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
    };
  }, [audioElement]);

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

  // Get all matching songs for each player
  const allMatchingSongs = team.players.flatMap(player => {
    if (!player.matchingSongs) return [];
    return player.matchingSongs.map(song => ({
      ...song,
      playerId: player.id,
      playerName: player.name,
      playerPosition: player.position,
      playerTeam: player.team
    }));
  }).sort((a, b) => b.matchScore - a.matchScore);

  return (
    <div className="w-full mt-6">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-base text-black">Team Playlist</h3>
        <button className="flex items-center bg-[#1ed660] bg-opacity-15 px-3 py-2 text-[#10a445] text-xs uppercase rounded-[4px] hover:bg-opacity-20 transition-all font-bold">
          <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Open in Spotify
        </button>
      </div>
      
      {/* Table Header */}
      <div className="overflow-hidden">
        <div className="p-2 border-b border-gray-200">
          <div className="grid grid-cols-12 gap-4 text-xs font-bold text-black text-opacity-70 uppercase">
            <div className="col-span-6 min-w-0">Song</div>
            <div className="col-span-4 min-w-0">Player</div>
            <div className="col-span-2 min-w-0">Match</div>
          </div>
        </div>
        
        {/* Playlist Items */}
        <div>
          {allMatchingSongs.map((song, index) => {
            const isPlaying = playingAudio === `${song.playerId}-${index}`;
            
            return (
              <div key={`${song.playerId}-${index}`} className="grid grid-cols-12 gap-4 p-2">
                {/* Song Info */}
                <div className="col-span-6 min-w-0 flex items-center">
                  <button 
                    onClick={() => handleAlbumClick(`${song.playerId}-${index}`, song.previewUrl)}
                    className="relative w-14 h-14 rounded overflow-hidden mr-3 group flex-shrink-0"
                  >
                    <Image 
                      src={song.albumArt} 
                      alt={song.songName} 
                      width={56}
                      height={56}
                      className="object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity flex items-center justify-center">
                      {isPlaying ? (
                        <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v4a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                      ) : song.previewUrl ? (
                        <svg className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                      ) : null}
                    </div>
                  </button>
                  <div className="flex flex-col min-w-0">
                    <span className="text-black font-medium truncate">{song.songName}</span>
                    <span className="text-black text-opacity-70 text-sm truncate">{song.artistName}</span>
                  </div>
                </div>
                
                {/* Player Info */}
                <div className="col-span-4 min-w-0">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 items-baseline">
                      <span className="text-black text-sm truncate">{song.playerName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-black text-opacity-70 font-bold uppercase text-xs">
                        {song.playerPosition}
                      </span>
                      <span className="text-black text-opacity-70 text-xs">{song.playerTeam}</span>
                    </div>
                  </div>
                </div>
                
                {/* Match Reason */}
                <div className="col-span-2 min-w-0">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-[#117B00] font-semibold truncate block">
                      <span className="hidden sm:inline">{song.matchReason}</span>
                      <span className="sm:hidden">
                        {song.matchReason.includes('Top song') ? 'Top song' :
                         song.matchReason.includes('Liked song') ? 'Liked' :
                         song.matchReason.includes('Top artist') ? 'Top artist' :
                         song.matchReason.includes('Partial artist') ? 'Artist match' :
                         song.matchReason.includes('Strong match') ? 'Genre match' :
                         song.matchReason.includes('Matches your genre') ? 'Genre match' :
                         '🎵 Match'}
                      </span>
                    </span>
                    {song.rankInfo && (
                      <span className="text-xs text-black text-opacity-70 truncate block hidden sm:block">
                        {song.rankInfo}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}