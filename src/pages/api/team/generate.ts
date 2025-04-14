// src/pages/api/team/generate.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { SpotifyService } from '@/services/spotify/spotifyService';
import { WalkupSongSyncService } from '@/services/walkupSongs/walkupSongSyncService'; // To get player data
import { TeamMatcherService } from '@/services/walkupSongs/teamMatcherService'; // To run matching logic
import { Player, Position, Team, Song, TeamStats } from '@/lib/mlb/types'; // Core app types
import { calculateTeamStats } from '@/services/mlb/statsCalculator'; // Stats calculation

// Define the required positions for a standard team roster
const POSITIONS: Position[] = ['SP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P1', 'P2', 'P3', 'P4'];

// Helper to assign specific pitcher roles (SP, P1-P4)
const assignPitcherPosition = (position: string | undefined, usedPositions: Set<Position>): Position => {
    // If not a pitcher or position is undefined, return as is (or a default)
     if (!position || !['P', 'SP', 'RP'].includes(position)) return (position || 'Unknown') as Position;

    const pitcherSlots: Position[] = ['SP', 'P1', 'P2', 'P3', 'P4'];
    for (const slot of pitcherSlots) {
        if (!usedPositions.has(slot)) {
            usedPositions.add(slot);
            return slot;
        }
    }
    // Fallback if all slots are somehow filled (shouldn't happen with 14 positions)
    return 'P1';
};


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    console.log("API: /api/team/generate invoked.");

    // 1. Authentication & Session Validation
    const session = await getSession({ req });
    if (!session || !session.accessToken) {
        console.error("API Generate: Unauthorized or session missing access token.");
        return res.status(401).json({ error: 'Unauthorized or session missing access token' });
    }
    const accessToken = session.accessToken;
    const userName = session.user?.name?.split(' ')[0] || 'User'; // Get user's first name
    console.log(`API Generate: Session valid for ${userName}.`);

    try {
        // 2. Instantiate Services
        const spotifyService = new SpotifyService(accessToken); // Pass token directly
        const walkupSongSyncService = WalkupSongSyncService.getInstance(); // Get singleton for DB access
        const teamMatcherService = new TeamMatcherService(spotifyService); // Inject SpotifyService

        // 3. Fetch User Preferences from Spotify
        console.log("API Generate: Fetching user preferences from Spotify...");
        const [genreSummary, topTracks, topArtists /*, savedTracks */] = await Promise.all([
            spotifyService.getUserGenres(),
            spotifyService.getAllTopTracks(),
            spotifyService.getAllTopArtists(),
            // spotifyService.getSavedTracks(50) // Fetch saved tracks if needed by matching logic
        ]);
        console.log(`API Generate: Preferences fetched. Top Genres: ${genreSummary.slice(0,3).map(g=>g.name).join(', ')}...`);

        // 4. Fetch Player Data from Local Database
        console.log("API Generate: Fetching player data from local DB...");
        const allPlayerSongsFromDb = await walkupSongSyncService.getAllPlayersFromDb();
         if (!allPlayerSongsFromDb || allPlayerSongsFromDb.length === 0) {
             console.error("API Generate: No player data found in the database. Cannot generate team.");
             // Optionally trigger a sync here if desired, but might take too long for API response
             // await walkupSongSyncService.updatePlayerData(); // <-- Be cautious with this in an API route
             return res.status(500).json({ error: 'Player data not available. Please try again later.' });
         }
        console.log(`API Generate: Fetched ${allPlayerSongsFromDb.length} players from DB.`);


        // 5. Generate Team using the Matcher Service
        console.log("API Generate: Calling TeamMatcherService.findTeamByPreferences...");
        const matchedPlayerSongs = await teamMatcherService.findTeamByPreferences(
            genreSummary,
            topTracks,
            topArtists,
            [], // Pass empty savedTracks if not fetched/used
            POSITIONS,
            allPlayerSongsFromDb, // Pass the fetched player data
            accessToken
            // userSavedAlbums: [], // Pass empty saved albums if not used
        );
        console.log(`API Generate: TeamMatcherService returned ${matchedPlayerSongs.length} players.`);

        // 6. Handle Empty Team Result
        if (matchedPlayerSongs.length === 0) {
            console.warn('API Generate: No matching players found, returning empty team structure.');
            return res.status(200).json({
                name: `${userName}'s Team`,
                players: [],
                songs: [],
                stats: { wins: 0, losses: 0, OPS: 0, AVG: 0, ERA: 0 }
            });
        }

        // 7. Format Final Team Structure (Players)
         console.log("API Generate: Formatting final team players...");
        const usedPitcherPositions = new Set<Position>(); // Track used P slots during formatting
        const selectedPlayers: Player[] = matchedPlayerSongs.map(playerSong => {
             const [firstName, ...lastNameParts] = playerSong.playerName.split(' ');
             const lastName = lastNameParts.join(' ');
             // Assign specific pitcher position here based on the matched player's role
             const assignedPosition = assignPitcherPosition(playerSong.position, usedPitcherPositions);

             // Get best album art from the matching songs details provided by the matcher
             const bestAlbumArt = playerSong.matchingSongs?.[0]?.albumArt || spotifyService.getDefaultAlbumArt();


            return {
                // Map fields from PlayerWalkupSong to the Player type used by frontend
                id: playerSong.playerId,
                name: playerSong.playerName,
                firstName,
                lastName,
                position: assignedPosition, // Use the specifically assigned position
                team: playerSong.team,
                teamAbbreviation: playerSong.teamId,
                headshot: bestAlbumArt, // Use album art as headshot placeholder
                stats: playerSong.stats, // Pass through stats
                matchingSongs: playerSong.matchingSongs // Pass through detailed song matches
            };
        });
        console.log(`API Generate: Formatted ${selectedPlayers.length} players.`);

        // 8. Format Final Team Structure (Songs) - Aggregate unique songs from selected players
        console.log("API Generate: Formatting final team songs...");
         const uniqueSongs = new Map<string, Song>(); // Use Spotify ID or 'name|artist' as key
         selectedPlayers.forEach(player => {
            (player.matchingSongs || []).forEach(matchDetail => {
                 const songKey = matchDetail.spotifyId || `${matchDetail.songName}|${matchDetail.artistName}`;
                 if (!uniqueSongs.has(songKey)) {
                     uniqueSongs.set(songKey, {
                         id: matchDetail.spotifyId || `${player.id}-${matchDetail.songName}`, // Create unique ID
                         name: matchDetail.songName,
                         artist: matchDetail.artistName,
                         albumArt: matchDetail.albumArt,
                         playerMatch: player.id, // Link back to the player primarily matched with
                         matchScore: matchDetail.matchScore,
                         matchReason: matchDetail.matchReason,
                         rankInfo: matchDetail.rankInfo,
                         previewUrl: matchDetail.previewUrl
                     });
                 }
            });
         });
         const songs: Song[] = Array.from(uniqueSongs.values())
                                     .sort((a, b) => b.matchScore - a.matchScore); // Sort playlist by match score
        console.log(`API Generate: Formatted ${songs.length} unique songs for playlist.`);


        // 9. Calculate Team Stats
        console.log("API Generate: Calculating team stats...");
        const hitters = selectedPlayers.filter(p => !['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
        const pitchers = selectedPlayers.filter(p => ['SP', 'P1', 'P2', 'P3', 'P4'].includes(p.position));
        const teamStats: TeamStats = calculateTeamStats(hitters, pitchers);
        console.log("API Generate: Calculated stats:", teamStats);

        // 10. Construct Final Team Object
        const finalTeam: Team = {
            name: `${userName}'s Team`,
            players: selectedPlayers,
            songs: songs,
            stats: teamStats
        };

        // 11. Send Response
        console.log("API Generate: Sending successful response.");
        return res.status(200).json(finalTeam);

    } catch (error) {
        console.error('API Generate: Unhandled error during team generation:', error);
        return res.status(500).json({ error: 'Failed to generate team due to an internal server error.' });
    }
}