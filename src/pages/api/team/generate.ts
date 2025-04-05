import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { SpotifyService } from '@/services/spotify/spotifyService';
import { WalkupSongFactory } from '@/services/walkupSongs/walkupSongFactory';
import { Player, Position, Team, Song } from '@/lib/mlb/types';
import { calculateTeamStats } from '@/services/mlb/statsCalculator';

// List of positions to fill
const POSITIONS: Position[] = ['SP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P1', 'P2', 'P3', 'P4'];

// Convert player position from database 'P' to specific pitcher position
const assignPitcherPosition = (position: string, usedPositions: Set<Position>): Position => {
  if (position !== 'P') return position as Position;
  
  // Try to assign SP first, then P1, P2, etc.
  const pitcherPositions: Position[] = ['SP', 'P1', 'P2', 'P3', 'P4'];
  for (const pos of pitcherPositions) {
    if (!usedPositions.has(pos)) {
      usedPositions.add(pos);
      return pos;
    }
  }
  return 'P1'; // Fallback, should never happen as we have enough positions
};

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
    
    // Get additional Spotify data for better matching
    const [topTracks, topArtists, savedTracks] = await Promise.all([
      spotifyService.getAllTopTracks(),
      spotifyService.getAllTopArtists(),
      spotifyService.getSavedTracks(50)
    ]);
    
    // Create walkup song service
    const walkupSongService = WalkupSongFactory.createService();
    
    // Generate team based on all preferences
    const matchedPlayerSongs = await walkupSongService.findTeamByPreferences(
      genreSummary,
      topTracks,
      topArtists,
      savedTracks,
      POSITIONS
    );
    
    // If we don't have matches for every position, we'll still return what we have
    if (matchedPlayerSongs.length === 0) {
      console.log('No matches found at all, returning empty team');
      return res.status(200).json({
        name: `${session.user?.name?.split(' ')[0]}'s Team`,
        players: [],
        songs: [],
        stats: {
          wins: 0,
          losses: 0,
          OPS: 0,
          AVG: 0,
          ERA: 0
        }
      });
    }
    
    // Track used pitcher positions
    const usedPitcherPositions = new Set<Position>();

    // Convert to Player objects for our app structure
    const selectedPlayers: Player[] = matchedPlayerSongs.map(playerSong => {
      const [firstName, ...lastNameParts] = playerSong.playerName.split(' ');
      const lastName = lastNameParts.join(' ');
      
      // Assign specific pitcher position if needed
      const position = assignPitcherPosition(playerSong.position, usedPitcherPositions);
      
      return {
        id: playerSong.playerId,
        name: playerSong.playerName,
        position: position,
        team: playerSong.team,
        headshot: `https://via.placeholder.com/32?text=${firstName.substring(0, 1)}`,
        firstName,
        lastName,
        teamAbbreviation: playerSong.teamId,
        stats: {
          batting: {
            battingAvg: playerSong.stats?.batting?.battingAvg || 0,
            onBasePercentage: playerSong.stats?.batting?.onBasePercentage || 0,
            sluggingPercentage: playerSong.stats?.batting?.sluggingPercentage || 0
          },
          pitching: {
            earnedRunAvg: playerSong.stats?.pitching?.earnedRunAvg || 0
          }
        },
        matchingSongs: playerSong.matchingSongs
      };
    });
    
    // Convert to Song objects for our app structure
    const songs: Song[] = (await Promise.all(matchedPlayerSongs.flatMap(async playerSong => {
      // Get all matching songs for this player
      const allSongs = playerSong.matchingSongs || [{
        songName: playerSong.walkupSong.songName,
        artistName: playerSong.walkupSong.artistName,
        matchScore: playerSong.matchScore || 1,
        matchReason: playerSong.matchReason || 'Based on your music taste',
        rankInfo: playerSong.rankInfo
      }];

      // Convert each matching song to a Song object
      return await Promise.all(allSongs.map(async song => {
        let albumArt = spotifyService.getDefaultAlbumArt();
        
        // Search for the song on Spotify
        const spotifyTrack = await spotifyService.searchTrack(
          song.songName,
          song.artistName
        );
        
        if (spotifyTrack?.album?.images) {
          albumArt = spotifyService.getBestAlbumArtUrl(spotifyTrack.album.images);
        }
        
        return {
          id: `${playerSong.playerId}-${song.songName}`,
          name: song.songName,
          artist: song.artistName,
          albumArt,
          playerMatch: playerSong.playerId,
          matchScore: song.matchScore,
          matchReason: song.matchReason,
          rankInfo: song.rankInfo,
          previewUrl: spotifyTrack?.preview_url
        };
      }));
    }))).flat();
    
    // Separate players by position type (using all pitcher positions)
    const hitters = selectedPlayers.filter(p => !['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
    const pitchers = selectedPlayers.filter(p => ['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
    
    // Calculate team stats
    const stats = calculateTeamStats(hitters, pitchers);
    
    // Create the team object
    const team: Team = {
      name: `${session.user?.name?.split(' ')[0]}'s Team`,
      players: selectedPlayers,
      songs: songs,
      stats
    };
    
    return res.status(200).json(team);
  } catch (error) {
    console.error('Team generation error:', error);
    return res.status(500).json({ error: 'Failed to generate team' });
  }
}