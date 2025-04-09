// /pages/api/team/generate.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react'; // Keep using this
import { SpotifyService } from '@/services/spotify/spotifyService';
import { WalkupSongService } from '@/services/walkupSongs/walkupSongService'; // Service class from its file
import { WalkupSongFactory } from '@/services/walkupSongs/walkupSongFactory'; // Factory class from its file
import { Player, Position, Team, Song } from '@/lib/mlb/types';
import { calculateTeamStats } from '@/services/mlb/statsCalculator';

// List of positions to fill
const POSITIONS: Position[] = ['SP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P1', 'P2', 'P3', 'P4'];

// Convert player position function (keep as is)
const assignPitcherPosition = (position: string, usedPositions: Set<Position>): Position => {
  // ... (implementation unchanged)
  if (position !== 'P') return position as Position;
  const pitcherPositions: Position[] = ['SP', 'P1', 'P2', 'P3', 'P4'];
  for (const pos of pitcherPositions) {
    if (!usedPositions.has(pos)) {
      usedPositions.add(pos);
      return pos;
    }
  }
  return 'P1';
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });

  // --- Add check for accessToken in session ---
  if (!session || !session.accessToken) {
    console.error("generate.ts: Unauthorized or session missing access token.");
    return res.status(401).json({ error: 'Unauthorized or session missing access token' });
  }
  // --- Store the accessToken ---
  const accessToken = session.accessToken;
  console.log("generate.ts: Session valid, accessToken retrieved.");

  // Create spotifyService instance (using the valid session)
  const spotifyService = SpotifyService.fromSession(session);

  // This check might be redundant now if session.accessToken is checked above, but keep for safety
  if (!spotifyService) {
     console.error("generate.ts: Failed to create SpotifyService instance.");
     return res.status(400).json({ error: 'No Spotify access token available (SpotifyService creation failed)' });
  }

  try {
    console.log("generate.ts: Fetching user preferences...");
    // Get user's genre preferences
    const genreSummary = await spotifyService.getUserGenres();

    // Get additional Spotify data for better matching
    const [topTracks, topArtists, savedTracks] = await Promise.all([
      spotifyService.getAllTopTracks(),
      spotifyService.getAllTopArtists(),
      spotifyService.getSavedTracks(50) // Note: Saved Albums aren't fetched here, pass empty array below
    ]);
    console.log("generate.ts: Preferences fetched.");

    // Create walkup song service
    const walkupSongService = WalkupSongFactory.createService();
    console.log("generate.ts: Calling findTeamByPreferences...");

    // Generate team based on all preferences
    // --- Pass the accessToken as the last argument ---
    const matchedPlayerSongs = await walkupSongService.findTeamByPreferences(
      genreSummary,
      topTracks,
      topArtists,
      savedTracks,
      POSITIONS,
      [], // Pass empty array for userSavedAlbums if not fetched/used yet
      accessToken // <-- THE FIX: Pass the token here
    );
    console.log(`generate.ts: findTeamByPreferences returned ${matchedPlayerSongs.length} players.`);

    // --- Rest of the handler remains exactly the same ---

    if (matchedPlayerSongs.length === 0) {
      // ... (empty team handling unchanged) ...
       console.log('generate.ts: No matches found, returning empty team structure.');
      return res.status(200).json({
        name: `${session.user?.name?.split(' ')[0]}'s Team`,
        players: [],
        songs: [],
        stats: { wins: 0, losses: 0, OPS: 0, AVG: 0, ERA: 0 }
      });
    }

    const usedPitcherPositions = new Set<Position>();
    const selectedPlayers: Player[] = matchedPlayerSongs.map(playerSong => {
      // ... (player mapping unchanged, includes ERA mapping) ...
        const [firstName, ...lastNameParts] = playerSong.playerName.split(' ');
      const lastName = lastNameParts.join(' ');
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
            earnedRunAvg: playerSong.stats?.pitching?.earnedRunAvg || 0,
            // Make sure inningsPitched is included if calculateTeamStats needs it!
             inningsPitched: playerSong.stats?.pitching?.inningsPitched || 0
          }
        },
        matchingSongs: playerSong.matchingSongs
      };
    });
     console.log(`generate.ts: Mapped ${selectedPlayers.length} players.`);

    const songs: Song[] = (await Promise.all(matchedPlayerSongs.flatMap(async playerSong => {
       // ... (song mapping unchanged) ...
      const allSongs = playerSong.matchingSongs || [{ /* ... default song object ... */ }];
       return await Promise.all(allSongs.map(async song => {
         let albumArt = spotifyService.getDefaultAlbumArt();
         const spotifyTrack = await spotifyService.searchTrack(song.songName, song.artistName);
         if (spotifyTrack?.album?.images) {
           albumArt = spotifyService.getBestAlbumArtUrl(spotifyTrack.album.images);
         }
         return { /* ... song object ... */
            id: `${playerSong.playerId}-${song.songName}`,
          name: song.songName,
          artist: song.artistName,
          albumArt,
          playerMatch: playerSong.playerId,
          matchScore: song.matchScore || 0, // Ensure default score if needed
          matchReason: song.matchReason || 'Unknown',
          rankInfo: song.rankInfo || '',
          previewUrl: spotifyTrack?.preview_url
         };
       }));
     }))).flat();
    console.log(`generate.ts: Mapped ${songs.length} songs.`);

    const hitters = selectedPlayers.filter(p => !['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
    const pitchers = selectedPlayers.filter(p => ['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
    console.log(`generate.ts: Calling calculateTeamStats with ${hitters.length} hitters, ${pitchers.length} pitchers.`);

    const stats = calculateTeamStats(hitters, pitchers);
     console.log("generate.ts: Calculated stats:", stats);

    const team: Team = {
      name: `${session.user?.name?.split(' ')[0]}'s Team`,
      players: selectedPlayers,
      songs: songs,
      stats // <-- This stats object should be calculated correctly as before
    };

    return res.status(200).json(team);

  } catch (error) {
    console.error('Team generation error in generate.ts:', error);
    return res.status(500).json({ error: 'Failed to generate team' });
  }
}