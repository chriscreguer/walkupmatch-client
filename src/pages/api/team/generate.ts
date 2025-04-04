import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { SpotifyService } from '@/services/spotify/spotifyService';
import { WalkupSongFactory } from '@/services/walkupSongs/walkupSongFactory';
import { Player, Position, Team, Song } from '@/lib/mlb/types';
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
    
    // Convert to Player objects for our app structure
    const selectedPlayers: Player[] = matchedPlayerSongs.map(playerSong => {
      const [firstName, ...lastNameParts] = playerSong.playerName.split(' ');
      const lastName = lastNameParts.join(' ');
      return {
        id: playerSong.playerId,
        name: playerSong.playerName,
        position: playerSong.position as Position,
        team: playerSong.team,
        headshot: `https://via.placeholder.com/32?text=${firstName.substring(0, 1)}`,
        firstName,
        lastName,
        teamAbbreviation: playerSong.teamId
      };
    });
    
    // Convert to Song objects for our app structure
    const songs = await Promise.all(matchedPlayerSongs.map(async playerSong => {
      let albumArt = spotifyService.getDefaultAlbumArt();
      
      // Search for the song on Spotify
      const spotifyTrack = await spotifyService.searchTrack(
        playerSong.walkupSong.songName,
        playerSong.walkupSong.artistName
      );
      
      if (spotifyTrack?.album?.images) {
        albumArt = spotifyService.getBestAlbumArtUrl(spotifyTrack.album.images);
      }
      
      return {
        id: playerSong.walkupSong.id,
        name: playerSong.walkupSong.songName,
        artist: playerSong.walkupSong.artistName,
        albumArt,
        playerMatch: playerSong.playerId,
        matchScore: 1,
        matchReason: playerSong.matchReason || 'Based on your music taste',
        rankInfo: playerSong.rankInfo,
        previewUrl: spotifyTrack?.preview_url
      };
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
      songs: songs,
      stats
    };
    
    return res.status(200).json(team);
  } catch (error) {
    console.error('Team generation error:', error);
    return res.status(500).json({ error: 'Failed to generate team' });
  }
}