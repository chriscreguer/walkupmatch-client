import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { SpotifyService } from '@/services/spotify/spotifyService';
import { WalkupSongFactory } from '@/services/walkupSongs/walkupSongFactory';
import { Player, Position, Team } from '@/lib/mlb/types';
import { calculateTeamStats } from '@/services/mlb/statsCalculator';

// List of positions to fill
const POSITIONS: Position[] = ['SP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'RP'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const spotifyService = SpotifyService.fromSession(session);
  
  if (!spotifyService) {
    return res.status(400).json({ error: 'No Spotify access token available' });
  }
  
  try {
    // Get user's genre preferences
    const genreSummary = await spotifyService.getUserGenres();
    
    // Create walkup song service
    const walkupSongService = WalkupSongFactory.createService();
    
    // Generate team based on genre preferences
    const matchedPlayerSongs = await walkupSongService.findTeamByGenrePreferences(
      genreSummary,
      POSITIONS
    );
    
    // If we don't have matches for every position, we'll get an error
    if (matchedPlayerSongs.length === 0) {
      return res.status(404).json({ error: 'No matching players found' });
    }
    
    // Convert to Player objects for our app structure
    const selectedPlayers: Player[] = matchedPlayerSongs.map(playerSong => ({
      id: playerSong.playerId,
      name: playerSong.playerName,
      position: playerSong.position as Position,
      team: playerSong.team,
      imageUrl: `https://via.placeholder.com/32?text=${playerSong.playerName.substring(0, 1)}`
    }));
    
    // Create song objects for the team
    const selectedSongs = matchedPlayerSongs.map(playerSong => ({
      id: playerSong.walkupSong.id,
      name: playerSong.walkupSong.songName,
      artist: playerSong.walkupSong.artistName,
      albumArt: playerSong.walkupSong.spotifyId 
        ? `https://i.scdn.co/image/${playerSong.walkupSong.spotifyId}`
        : 'https://via.placeholder.com/56',
      playerMatch: playerSong.playerId,
      matchScore: 3 // For now, hardcoded strong match
    }));
    
    // Separate players by position type
    const hitters = selectedPlayers.filter(p => !['SP', 'RP'].includes(p.position));
    const pitchers = selectedPlayers.filter(p => ['SP', 'RP'].includes(p.position));
    
    // Calculate team stats
    const stats = calculateTeamStats(hitters, pitchers);
    
    // Create the team object
    const team: Team = {
      name: `${session.user?.name?.split(' ')[0]}'s Team`,
      players: selectedPlayers,
      songs: selectedSongs,
      stats
    };
    
    return res.status(200).json(team);
  } catch (error) {
    console.error('Team generation error:', error);
    return res.status(500).json({ error: 'Failed to generate team' });
  }
}