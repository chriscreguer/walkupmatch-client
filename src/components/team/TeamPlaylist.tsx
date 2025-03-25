import { MLBPlayer } from '../../lib/mlb/types';

interface TeamPlaylistProps {
  players: MLBPlayer[];
}

export default function TeamPlaylist({ players }: TeamPlaylistProps) {
  // Filter players that have walkup songs
  const playersWithSongs = players.filter(player => player.walkupSong);
  
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Team Playlist</h2>
        <button className="text-sm text-green-600 font-semibold hover:underline">
          Open in Spotify
        </button>
      </div>
      
      {/* Table Header */}
      <div className="grid grid-cols-12 py-2 border-b border-black/10">
        <div className="col-span-6">
          <span className="text-xs font-bold uppercase text-black/70">Song</span>
        </div>
        <div className="col-span-4">
          <span className="text-xs font-bold uppercase text-black/70">Player</span>
        </div>
        <div className="col-span-2 text-right">
          <span className="text-xs font-bold uppercase text-black/70">Match</span>
        </div>
      </div>
      
      {/* Song Rows */}
      {playersWithSongs.map((player) => (
        <div key={player.id} className="grid grid-cols-12 py-3 border-b border-black/10 items-center">
          {/* Song Column */}
          <div className="col-span-6 flex items-center">
            <div className="w-14 h-14 relative bg-gray-200 rounded">
              {/* Album art would go here */}
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                <span>♪</span>
              </div>
            </div>
            <div className="ml-3">
              <p className="text-base font-medium">{player.walkupSong?.title}</p>
              <p className="text-sm text-black/70">{player.walkupSong?.artist}</p>
            </div>
          </div>
          
          {/* Player Column */}
          <div className="col-span-4">
            <p className="text-xs font-bold uppercase text-black/70">{player.position}</p>
            <p className="text-sm">{player.name}</p>
            <p className="text-xs text-black/70">{player.team}</p>
          </div>
          
          {/* Match Column */}
          <div className="col-span-2 flex justify-end">
            <div className="flex space-x-1">
              {/* Sample match level (3 dots) */}
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="w-2 h-2 rounded-full bg-gray-300"></span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}