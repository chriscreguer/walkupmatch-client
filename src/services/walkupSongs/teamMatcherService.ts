// src/services/walkupSongs/teamMatcherService.ts
import { PlayerWalkupSong, WalkupSong } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary, SpotifyTopItem, SpotifyService } from '@/services/spotify/spotifyService';
import { Position, PlayerStats } from '@/lib/mlb/types';
import { TeamStatsModel } from '@/models/teamStatsModel'; // For fetching games played validation
import {
    NormalizedTrack,
    NormalizedArtist,
    MatchResult,
    PlayerWithScore,
    SongMatchDetails,
    TeamAssignment,
    TimeFrame
} from '@/lib/walkupSongs/matchingTypes'; // Use centralized types
import {
    SCORE_WEIGHTS,
    COMPATIBLE_POSITIONS,
    SIMILAR_POSITIONS,
    FALLBACK_POSITIONS,
    POSITION_WEIGHTS,
    MIN_MATCH_SCORE,
    MULTIPLE_SONG_BONUS,
    DIVERSITY_THRESHOLD,
    DIVERSITY_BOOST_AMOUNT,
    NUM_USER_TOP_GENRES,
    MIN_GAMES_PLAYED_THRESHOLD,
    HITTER_PA_PER_GAME_THRESHOLD,
    PITCHER_IP_PER_GAME_THRESHOLD
} from '@/config/matchingConfig'; // Use centralized config

export class TeamMatcherService {
    private spotifyService: SpotifyService;
    private usedSongs: Set<string>; // Key: 'songname|artistname'
    private usedArtistsMap: Map<string, number>; // Key: 'artistname', Value: count
    private genreSimilarityCache: Map<string, boolean>; // Key: 'genre1|genre2'
    private tigersGamesPlayed: number | null = null;

    // Inject SpotifyService dependency
    constructor(spotifyService: SpotifyService) {
        this.spotifyService = spotifyService;
        this.usedSongs = new Set();
        this.usedArtistsMap = new Map();
        this.genreSimilarityCache = new Map();
    }

    /**
     * Main method to find a team based on user preferences and player data.
     * @param userGenres - User's top genres with weights.
     * @param userTopTracks - User's top tracks across time frames.
     * @param userTopArtists - User's top artists across time frames.
     * @param userSavedTracks - User's liked/saved tracks.
     * @param positions - The list of team positions to fill.
     * @param allPlayerSongsFromDb - Pre-fetched player data from the database.
     * @param accessToken - User's Spotify access token (needed for liked track check).
     * @returns A promise resolving to an array of PlayerWalkupSong representing the final team.
     */
    async findTeamByPreferences(
        userGenres: SpotifyGenreSummary[],
        userTopTracks: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
        userTopArtists: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
        userSavedTracks: SpotifyTopItem[], // Assuming these are pre-fetched if needed by checkLikedSong legacy
        positions: Position[],
        allPlayerSongsFromDb: PlayerWalkupSong[], // Expects data from WalkupSongSyncService.getAllPlayersFromDb()
        accessToken: string
        // userSavedAlbums: SpotifyTopItem[] = [], // Add if saved album logic is implemented
    ): Promise<PlayerWalkupSong[]> {

        console.log("TeamMatcherService: Starting findTeamByPreferences...");

        // 1. Fetch Validation Data (Tigers Games Played)
        try {
            const teamStats = await TeamStatsModel.findOne({ teamId: 'det' });
            this.tigersGamesPlayed = teamStats ? teamStats.gamesPlayed : MIN_GAMES_PLAYED_THRESHOLD; // Use config default if not found
            console.log(`TeamMatcherService: Using Tigers games played for validation: ${this.tigersGamesPlayed}`);
        } catch (error) {
            console.error('TeamMatcherService: Error fetching Tigers games played, using default:', error);
            this.tigersGamesPlayed = MIN_GAMES_PLAYED_THRESHOLD;
        }

        // 2. Reset State for this matching run
        this.usedSongs.clear();
        this.usedArtistsMap.clear();
        this.genreSimilarityCache.clear();

        // 3. Initialize Diversity Boost Logic
        const userTopNGenres = new Set(
            userGenres.slice(0, NUM_USER_TOP_GENRES).map(g => g.name.toLowerCase())
        );
        const teamGenreCounts: Map<string, number> = new Map(); // Track genres selected for the team

        // 4. Filter Players by Stats and Valid Walkup Song
        console.log(`TeamMatcherService: Initial player count: ${allPlayerSongsFromDb.length}`);
        const validPlayers = allPlayerSongsFromDb.filter(player => {
             // Basic walkup song validation
            const hasValidWalkupSong = player.walkupSongs && player.walkupSongs.length > 0 &&
                player.walkupSongs[0].songName && player.walkupSongs[0].artistName &&
                player.walkupSongs[0].songName !== 'No walkup song' && player.walkupSongs[0].songName !== 'Unknown Song'; // Check default names

             if (!hasValidWalkupSong) return false;

             // Stat validation
             return this.validatePlayerStats(player); // Use internal helper
        });
        console.log(`TeamMatcherService: Players after filtering: ${validPlayers.length}`);
        if (validPlayers.length === 0) {
            console.warn("TeamMatcherService: No valid players found after filtering. Cannot generate team.");
            return [];
        }

        // 5. Prepare for Liked Track Check
        const allSpotifyIdsToCheck = new Set<string>();
        validPlayers.forEach(player => {
            player.walkupSongs?.forEach(song => {
                if (song.spotifyId) allSpotifyIdsToCheck.add(song.spotifyId);
            });
        });
        const uniqueSpotifyIdsArray = Array.from(allSpotifyIdsToCheck);
        console.log(`TeamMatcherService: Found ${uniqueSpotifyIdsArray.length} unique Spotify IDs from valid players to check liked status.`);

        // 6. Perform Liked Track Check (using injected SpotifyService)
        let likedTrackIdSet = new Set<string>();
        if (uniqueSpotifyIdsArray.length > 0) {
            try {
                const likedStatusArray = await this.spotifyService.checkSongsInLikedTracks(uniqueSpotifyIdsArray);
                uniqueSpotifyIdsArray.forEach((id, index) => {
                    if (likedStatusArray[index]) likedTrackIdSet.add(id);
                });
                console.log(`TeamMatcherService: Found ${likedTrackIdSet.size} liked songs among the checked IDs.`);
            } catch (error) {
                console.error("TeamMatcherService: Failed to perform batch check for liked songs, proceeding without liked song data:", error);
                // Continue without liked song data, scores will be lower for this aspect
            }
        }

        // 7. Normalize User Preferences
        const userTopGenresNormalized = userGenres.slice(0, 10).map(g => ({
            name: g.name.toLowerCase(),
            weight: g.weight
        }));
         const normalizedUserTracks: Record<TimeFrame, NormalizedTrack[]> = { long_term: [], medium_term: [], short_term: [] };
         const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
         for (const timeFrame of timeFrames) {
             normalizedUserTracks[timeFrame] = (userTopTracks[timeFrame] || []).map((track, index) => ({
                 name: (track.name || '').toLowerCase(),
                 artist: (track.artists?.[0]?.name || '').toLowerCase(), // Primary artist
                 spotifyId: track.id,
                 albumId: track.album?.id,
                 albumName: track.album?.name || '',
                 rank: index + 1,
                 timeFrame
             }));
         }
         const normalizedUserArtists: Record<TimeFrame, NormalizedArtist[]> = { long_term: [], medium_term: [], short_term: [] };
         for (const timeFrame of timeFrames) {
             normalizedUserArtists[timeFrame] = (userTopArtists[timeFrame] || []).map((artist, index) => ({
                 name: (artist.name || '').toLowerCase(),
                 id: artist.id,
                 rank: index + 1,
                 timeFrame
             }));
         }
        // Note: Handling of saved tracks map depends on whether checkLikedSong legacy method is kept/used
        // const savedTracksMap = new Map<string, boolean>(); // ... populate if needed ...
         const artistsWithLikedSongs = new Set<string>(); // Populate based on liked/top artists
         likedTrackIdSet.forEach(trackId => {
            // Find corresponding track in user's data to get artist name
             for (const tf of timeFrames) {
                 const track = normalizedUserTracks[tf].find(t => t.spotifyId === trackId);
                 if (track?.artist) {
                     artistsWithLikedSongs.add(track.artist);
                     break;
                 }
             }
         });
         // Add top artists too
         for (const tf of timeFrames) {
            normalizedUserArtists[tf].forEach(artist => artistsWithLikedSongs.add(artist.name));
         }

        // 8. Calculate Match Scores for All Valid Players
        const playersWithScoresPromises: Promise<PlayerWithScore>[] = validPlayers.map(async (player): Promise<PlayerWithScore> => {
             // Defensive check (should be caught by filtering)
             if (!player.walkupSongs || player.walkupSongs.length === 0) {
                 return { player, matchScore: 0, originalMatchScore: 0, matchReason: 'No valid walkup songs', rankInfo: '', matchingSongs: [] };
             }

             // Evaluate each song the player has
             const songMatchDetailsPromises: Promise<SongMatchDetails>[] = player.walkupSongs.map(async (song) => {
                 const normalizedPlayerSong = {
                     name: song.songName.toLowerCase(),
                     artist: song.artistName.toLowerCase(), // Use combined for now, could refine
                     spotifyId: song.spotifyId || '',
                     genres: (song.genre || []).map(g => g.toLowerCase()),
                      // Include structured artists if available and needed by matching logic
                      artists: song.artists?.map(a => ({ name: a.name.toLowerCase(), role: a.role }))
                 };

                 const songMatches = await this.findAllSongMatches(normalizedPlayerSong, normalizedUserTracks, likedTrackIdSet, accessToken);
                 const artistMatches = this.findAllArtistMatches(normalizedPlayerSong, normalizedUserTracks, normalizedUserArtists); // Removed savedTracksMap argument
                 const genreMatch = this.calculateGenreMatchScore(userTopGenresNormalized, normalizedPlayerSong.genres, normalizedPlayerSong.artist, artistsWithLikedSongs);

                 // Combine scores using "Primary + 5% Others" logic
                 const potentialMatches = [
                     { type: 'Song', ...songMatches.sort((a, b) => b.score - a.score)[0] }, // Best song match
                     { type: 'Artist', ...artistMatches.sort((a, b) => b.score - a.score)[0] }, // Best artist match
                     { type: 'Genre', ...genreMatch }
                 ].filter(m => m.score && m.score > 0.001) // Filter out zero/negligible scores
                  .sort((a, b) => b.score - a.score); // Sort by score descending

                 let finalCombinedScore = 0;
                 let finalReason = 'No Match';
                 let finalDetails = '';

                 if (potentialMatches.length > 0) {
                     const primaryMatch = potentialMatches[0];
                     const sumOfOtherScores = potentialMatches.slice(1).reduce((sum, match) => sum + (match.score || 0), 0);
                     finalCombinedScore = (primaryMatch.score || 0) + (0.05 * sumOfOtherScores); // Apply 5% bonus

                     finalReason = primaryMatch.reason || primaryMatch.type || 'Unknown Match';
                     finalDetails = primaryMatch.details || '';
                     if (sumOfOtherScores > 0.001 && potentialMatches.length > 1) {
                          const otherReasons = potentialMatches.slice(1).map(m => m.reason || m.type).join(', ');
                          // Append bonus reason carefully
                          const bonusReason = `+ bonus (${otherReasons.substring(0, 30)}${otherReasons.length > 30 ? '...' : ''})`;
                          finalReason = `${finalReason.substring(0,40)}${finalReason.length > 40 ? '...' : ''} ${bonusReason}`;
                     }
                 }

                 return {
                     songName: song.songName,
                     artistName: song.artistName,
                     matchScore: finalCombinedScore,
                     matchReason: finalReason,
                     rankInfo: finalDetails,
                     albumArt: song.albumArt || this.spotifyService.getDefaultAlbumArt(), // Use default art if missing
                     previewUrl: song.previewUrl || null, // Pass through preview URL
                     spotifyId: song.spotifyId
                 };
             }); // End songMatchDetailsPromises map

             const evaluatedSongs = await Promise.all(songMatchDetailsPromises);

             // Find the best song score for this player
              const bestSongResult = evaluatedSongs.reduce(
                  (best, current) => (current.matchScore > best.matchScore ? current : best),
                  { matchScore: 0, matchReason: 'N/A', rankInfo: '' } // Initial best
              );

             const basePlayerScore = bestSongResult.matchScore;

             // Calculate Stats Bonus
             const statsBonus = this.calculateStatsBonus(player);

             const finalPlayerScore = basePlayerScore + statsBonus;

             return {
                 player,
                 matchScore: finalPlayerScore,
                 originalMatchScore: finalPlayerScore,
                 matchReason: bestSongResult.matchReason,
                 rankInfo: bestSongResult.rankInfo,
                 matchingSongs: evaluatedSongs.filter(s => s.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore) // Include all scored songs, sorted
             };
        }); // End playersWithScoresPromises map

        const playersWithScoresResolved: PlayerWithScore[] = await Promise.all(playersWithScoresPromises);

        // 9. Filter out players below minimum score and initial sort
        const candidatePool = playersWithScoresResolved
            .filter(p => p.matchScore >= MIN_MATCH_SCORE)
            .sort((a, b) => b.matchScore - a.matchScore); // Initial sort by raw score

         if (candidatePool.length === 0) {
             console.warn("TeamMatcherService: No players met the minimum match score. Cannot generate team.");
             return [];
         }

         console.log(`TeamMatcherService: Starting team selection with ${candidatePool.length} candidates.`);

         // 10. ----- TEAM SELECTION LOOP -----
         const team: { [position: string]: TeamAssignment } = {};
         const usedCandidateIds = new Set<string>(); // Track player IDs used
         const usedSongKeys = new Set<string>(); // Track 'song|artist' keys used

         for (const targetPosition of positions) {
             // Filter candidates eligible for the *target* position who haven't been picked
             const eligibleCandidates = candidatePool.filter(candidate =>
                 this.isCandidateEligibleForPosition(candidate, targetPosition) &&
                 !usedCandidateIds.has(candidate.player.playerId)
             );

             console.log(`\nTeamMatcherService: Processing Position: ${targetPosition}. Eligible Candidates: ${eligibleCandidates.length}`);
              if(eligibleCandidates.length === 0) {
                  console.log(` -> No eligible candidates found.`);
                  continue; // Skip to next position
              }

             // Calculate Diversity Boost for sorting *within* this position's candidates
             const candidatesWithBoost = eligibleCandidates.map(candidate => {
                 let diversityBoost = 0;
                 let contributingGenre: string | null = null;

                 // Find the genres of the player's *best matching song*
                  const bestSongMatch = candidate.matchingSongs[0]; // Assumes matchingSongs is sorted desc by score
                  let songGenres: string[] = [];
                  if (bestSongMatch) {
                      const walkupSongData = candidate.player.walkupSongs?.find(
                          ws => ws.songName === bestSongMatch.songName && ws.artistName === bestSongMatch.artistName
                      );
                      songGenres = walkupSongData?.genre?.map(g => g.toLowerCase()) || [];
                  }

                 for (const genre of songGenres) {
                     if (userTopNGenres.has(genre)) {
                         const currentGenreCount = teamGenreCounts.get(genre) || 0;
                         if (currentGenreCount < DIVERSITY_THRESHOLD) {
                             diversityBoost = DIVERSITY_BOOST_AMOUNT;
                             contributingGenre = genre;
                             break; // Apply boost for the first eligible top genre found
                         }
                     }
                 }
                  // Log boost calculation for debugging
                  // if (diversityBoost > 0) {
                  //     console.log(` -> Boost Calc: ${candidate.player.playerName}, Base: ${candidate.matchScore.toFixed(3)}, Boost: ${diversityBoost.toFixed(3)}, Genre: ${contributingGenre}`);
                  // }

                 return {
                     ...candidate,
                     scoreForSorting: candidate.matchScore + diversityBoost, // Use boosted score *only* for sorting this position
                     boostingGenre: contributingGenre
                 };
             });

             // Sort candidates for *this position* by potentially boosted score
             const sortedEligible = candidatesWithBoost.sort((a, b) => (b.scoreForSorting ?? 0) - (a.scoreForSorting ?? 0));
              // console.log(` -> Sorted Candidates for ${targetPosition}:`, sortedEligible.map(c => ({ name: c.player.playerName, sortScore: c.scoreForSorting?.toFixed(3)})));

             // Select the best available candidate, applying penalties and uniqueness checks
             let candidateSelected = false;
             for (const candidate of sortedEligible) {
                 // Double check player hasn't been picked (should be handled by filter, but safe)
                 if (usedCandidateIds.has(candidate.player.playerId)) continue;

                 // Use the *primary* (first) walkup song for uniqueness check consistency
                 const primaryWalkupSong = candidate.player.walkupSongs?.[0];
                 if (!primaryWalkupSong || !primaryWalkupSong.songName || !primaryWalkupSong.artistName) continue; // Skip if somehow invalid

                 const songKey = `${primaryWalkupSong.songName.toLowerCase()}|${primaryWalkupSong.artistName.toLowerCase()}`;
                 if (usedSongKeys.has(songKey)) {
                     // console.log(` -> Skipping ${candidate.player.playerName} (Duplicate Song: ${songKey})`);
                     continue; // Skip if this primary song already used
                 }

                 // Apply artist diversity penalty based on *primary artist* of the primary song
                  const primaryArtistKey = primaryWalkupSong.artists?.[0]?.name?.toLowerCase() || primaryWalkupSong.artistName.split(',')[0].trim().toLowerCase();
                  const artistOccurrences = this.usedArtistsMap.get(primaryArtistKey) || 0;
                  const penaltyMultiplier = this.computePenaltyMultiplier(artistOccurrences);
                  // Apply penalty to the candidate's ORIGINAL score (not the boosted sorting score)
                  const scoreAfterPenalty = candidate.matchScore * (1 - penaltyMultiplier);

                  // console.log(` -> Evaluating ${candidate.player.playerName}: SortScore=${candidate.scoreForSorting?.toFixed(3)}, PenaltyMult=${penaltyMultiplier.toFixed(2)}, FinalAdjustedScore=${scoreAfterPenalty.toFixed(3)}`);

                 // Check if score is still above minimum threshold *after* penalty
                 if (scoreAfterPenalty >= MIN_MATCH_SCORE) {
                      // SELECT THIS CANDIDATE!
                     console.log(` -> Selected ${candidate.player.playerName} for ${targetPosition} (Score: ${candidate.matchScore.toFixed(3)}, Adjusted: ${scoreAfterPenalty.toFixed(3)}, BoostedForSort: ${candidate.scoreForSorting?.toFixed(3)}, PenaltyMult: ${penaltyMultiplier.toFixed(2)})`);

                     // Assign candidate to the team roster for this position
                     team[targetPosition] = { candidate, assignedPosition: targetPosition };

                     // Mark resources as used
                     usedCandidateIds.add(candidate.player.playerId);
                     usedSongKeys.add(songKey); // Mark the primary song key as used
                     this.usedArtistsMap.set(primaryArtistKey, artistOccurrences + 1); // Increment count for this artist

                     // Update Team Genre Count based on the selected player's *best matching song's genres*
                      let genreToCount: string | null = null;
                      const selectedWalkupSong = candidate.player.walkupSongs?.find(
                          ws => ws.songName === candidate.matchingSongs[0].songName && ws.artistName === candidate.matchingSongs[0].artistName
                      ); // Find the walkup song corresponding to the best matching song
                      const selectedSongGenres = selectedWalkupSong?.genre?.map(g => g.toLowerCase()) || [];

                      for(const g of selectedSongGenres) {
                          if (userTopNGenres.has(g)) {
                              genreToCount = g; // Prioritize counting a top user genre
                              break;
                          }
                      }
                      // Fallback: If no top genre match, use the first genre listed for the song
                      if (!genreToCount && selectedSongGenres.length > 0) {
                           genreToCount = selectedSongGenres[0];
                      }

                      if (genreToCount) {
                          const newCount = (teamGenreCounts.get(genreToCount) || 0) + 1;
                          teamGenreCounts.set(genreToCount, newCount);
                          console.log(` -> Team genre count updated: ${genreToCount} = ${newCount}`);
                      }

                     candidateSelected = true; // Mark as selected for this position
                     break; // Move to the next position in the outer loop
                 } else {
                      // console.log(` -> Skipping ${candidate.player.playerName} (Below min score after penalty)`);
                 }
             } // End loop through candidates for this position

             if (!candidateSelected) {
                  console.log(` -> Could not find suitable candidate for position ${targetPosition} after applying penalties/uniqueness checks.`);
             }

         } // End loop through positions

        // 11. Build Final Team Array
        const finalTeamResult: PlayerWalkupSong[] = positions
            .map(pos => team[pos]) // Get assignment for each position
            .filter((assignment): assignment is TeamAssignment => assignment !== undefined) // Filter out unfilled positions
             // Map to the final PlayerWalkupSong structure, ensuring the assigned position is set
            .map(assignment => ({
                 ...assignment.candidate.player, // Spread original player data (includes stats, all walkupSongs)
                 position: assignment.assignedPosition, // CRUCIAL: Set the assigned position
                 matchScore: assignment.candidate.matchScore, // Use the final calculated score
                 matchReason: assignment.candidate.matchReason,
                 rankInfo: assignment.candidate.rankInfo,
                 matchingSongs: assignment.candidate.matchingSongs // Include the detailed song matches
            }));

        console.log(`TeamMatcherService: Team generation complete. Final team size: ${finalTeamResult.length}`);
        console.log("TeamMatcherService: Final team genre distribution:", Object.fromEntries(teamGenreCounts));

        return finalTeamResult;

    } // End findTeamByPreferences


    // --- Helper Methods ---

    /**
     * Calculates a small bonus based on player stats relative to thresholds.
     */
     private calculateStatsBonus(player: PlayerWalkupSong): number {
        const STATS_BONUS_WEIGHT = 0.01; // Max possible bonus from stats
        let statsBonus = 0;

        try {
             // Use player's actual position for logic
            const playerPosition = player.position;

            if (!['P', 'SP', 'RP'].includes(playerPosition) && player.stats?.batting) {
                // Hitter Bonus based on OPS (adjust thresholds as needed)
                const ops = (player.stats.batting.onBasePercentage || 0) + (player.stats.batting.sluggingPercentage || 0);
                const opsThreshold = 0.700; // Example: Average-ish OPS
                const opsMax = 1.000; // Example: Elite OPS
                if (ops > opsThreshold) {
                     statsBonus = Math.min(1, (ops - opsThreshold) / (opsMax - opsThreshold)) * STATS_BONUS_WEIGHT;
                }
            } else if (['P', 'SP', 'RP'].includes(playerPosition) && player.stats?.pitching) {
                // Pitcher Bonus based on ERA (lower is better)
                const era = player.stats.pitching.earnedRunAvg ?? 99.0; // Default high if missing
                const eraThreshold = 4.50; // Example: League average-ish ERA
                const eraMin = 2.50; // Example: Elite ERA
                 if (era < eraThreshold && era > 0) { // Avoid division by zero or bonus for terrible ERA
                      statsBonus = Math.min(1, (eraThreshold - era) / (eraThreshold - eraMin)) * STATS_BONUS_WEIGHT;
                 }
            }
         } catch (e) {
            console.error(`Error calculating stats bonus for ${player.playerName}:`, e)
         }

         // Clamp the bonus between 0 and the max weight
        return Math.max(0, Math.min(statsBonus, STATS_BONUS_WEIGHT));
    }

    /**
     * Checks if a player meets minimum playing time thresholds based on team games played.
     */
    private validatePlayerStats(player: PlayerWalkupSong): boolean {
        try {
            if (!this.tigersGamesPlayed || this.tigersGamesPlayed <= 0) {
                console.warn(`TeamMatcherService: Invalid games played (${this.tigersGamesPlayed}) for validation. Skipping stat validation for ${player.playerName}`);
                return true; // Skip validation if prerequisite data is missing
            }

            const minGamesForValidation = Math.max(1, MIN_GAMES_PLAYED_THRESHOLD); // Ensure at least 1 game
            if(this.tigersGamesPlayed < minGamesForValidation) {
                // console.log(`TeamMatcherService: Team games played (${this.tigersGamesPlayed}) below threshold (${minGamesForValidation}). Skipping stat validation for ${player.playerName}.`);
                return true; // Not enough games played yet in the season to reliably validate
            }


            const playerPosition = player.position;
            const gamesPlayed = this.tigersGamesPlayed; // Use the fetched value

            if (!['P', 'SP', 'RP'].includes(playerPosition)) { // Hitter
                const minPA = gamesPlayed * HITTER_PA_PER_GAME_THRESHOLD;
                const currentPA = player.stats?.batting?.plateAppearances ?? 0;
                const isValid = currentPA >= minPA;
                 // if (!isValid) console.log(`Stat Validation FAIL ${player.playerName} (Hitter): PA=${currentPA} < MinPA=${minPA.toFixed(1)} (Based on ${gamesPlayed} games)`);
                return isValid;
            } else { // Pitcher
                const minIP = gamesPlayed * PITCHER_IP_PER_GAME_THRESHOLD;
                const currentIP = player.stats?.pitching?.inningsPitched ?? 0;
                const isValid = currentIP >= minIP;
                 // if (!isValid) console.log(`Stat Validation FAIL ${player.playerName} (Pitcher): IP=${currentIP.toFixed(1)} < MinIP=${minIP.toFixed(1)} (Based on ${gamesPlayed} games)`);
                return isValid;
            }
        } catch (error) {
            console.error(`TeamMatcherService: Error validating player stats for ${player.playerName}:`, error);
            return false; // Fail validation on error
        }
    }


    /**
     * Determines if a candidate player can be assigned to a target position.
     */
    private isCandidateEligibleForPosition(candidate: PlayerWithScore, targetPosition: Position): boolean {
        const playerPosition = candidate.player.position; // Position from DB/API
        if (!playerPosition || playerPosition === 'Unknown') return false; // Cannot be eligible without a known position

        // Exact Match
        if (playerPosition === targetPosition) return true;

        // Pitcher Handling
        if (['SP', 'P1', 'P2', 'P3', 'P4'].includes(targetPosition)) {
            // Target is a pitcher slot, player must be a pitcher type
            return ['P', 'SP', 'RP'].includes(playerPosition);
        }

         // Outfielder Handling
         if (['LF', 'CF', 'RF'].includes(targetPosition)) {
            // Target is specific OF slot, player must be an OF type
             return ['LF', 'CF', 'RF', 'OF'].includes(playerPosition);
         }

         // DH Handling - Can be filled by most non-pitchers
         if (targetPosition === 'DH') {
            const eligibleForDH = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'C', 'OF', 'DH'];
             return eligibleForDH.includes(playerPosition);
         }

        // Infield/Catcher Compatibility/Similarity Checks
        const compatible = COMPATIBLE_POSITIONS[targetPosition as keyof typeof COMPATIBLE_POSITIONS] || [];
        const similar = SIMILAR_POSITIONS[targetPosition as keyof typeof SIMILAR_POSITIONS] || [];
        // Fallback check specifically for non-DH target positions is less common, but could be added if needed

         if (compatible.includes(playerPosition)) return true;
         if (similar.includes(playerPosition)) return true;

         // Add specific fallback logic if needed for non-DH positions, e.g. allowing 3B to play 1B as fallback
         // const fallback = FALLBACK_POSITIONS[targetPosition as keyof typeof FALLBACK_POSITIONS] || [];
         // if (fallback.includes(playerPosition)) return true;


        return false; // Not eligible
    }

    /**
     * Computes the score penalty multiplier based on how many times an artist has already been picked.
     */
    private computePenaltyMultiplier(occurrenceIndex: number): number {
        // occurrenceIndex is 0-based (0 means first time, 1 means second time, etc.)
        const penalties = SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY;
        if (occurrenceIndex <= 0) return penalties.FIRST; // 0%
        if (occurrenceIndex === 1) return penalties.SECOND;
        if (occurrenceIndex === 2) return penalties.THIRD;
        if (occurrenceIndex === 3) return penalties.FOURTH;
        return penalties.FIFTH_PLUS; // For 4th occurrence (index 4) and beyond
    }

    /**
     * Finds all matches for a player's song based on user's top tracks and liked tracks.
     * @param playerSong - Normalized player song data.
     * @param userTracks - Normalized user top tracks.
     * @param likedTrackIdSet - Set of Spotify IDs the user has liked.
     * @param accessToken - User's Spotify access token.
     * @returns Array of match results for the song.
     */
    private async findAllSongMatches(
        playerSong: { name: string; artist: string; genres: string[]; spotifyId?: string },
        userTracks: Record<TimeFrame, NormalizedTrack[]>,
        likedTrackIdSet: Set<string>,
        accessToken: string // Keep if needed for future direct API calls within this function
    ): Promise<MatchResult[]> {
        const matches: MatchResult[] = [];
        const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];

        // 1. Check against Top Tracks
        for (const timeFrame of timeFrames) {
             const tracks = userTracks[timeFrame] || [];
             const artistList = playerSong.artist.split(',').map(a => a.trim().toLowerCase()); // Handle multiple artists

             for (const artistName of artistList) {
                  const matchedTrack = tracks.find(track =>
                      track.name === playerSong.name && track.artist === artistName
                  );

                 if (matchedTrack && matchedTrack.rank) { // Ensure rank exists
                      const rank = matchedTrack.rank;
                      const timeFrameBonus = SCORE_WEIGHTS.TIME_FRAME[timeFrame];
                      let rankBonus = SCORE_WEIGHTS.RANK.TOP_50; // Default lowest bonus
                      if (rank <= 10) rankBonus = SCORE_WEIGHTS.RANK.TOP_10;
                      else if (rank <= 25) rankBonus = SCORE_WEIGHTS.RANK.TOP_25;

                     const score = SCORE_WEIGHTS.MATCH_TYPE.TOP_SONG + timeFrameBonus + rankBonus;
                      const details = `#${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}`;
                      matches.push({ score, reason: 'Top song', details, rank, timeFrame });
                      // Found match for this artist/song combo in this timeframe, potentially break inner loop if needed
                      // break; // Or remove if you want to potentially find lower ranks in other timeframes for the same artist
                 }
             }
        }

        // 2. Check against Liked Tracks (using pre-fetched set)
         if (playerSong.spotifyId && likedTrackIdSet.has(playerSong.spotifyId)) {
             matches.push({
                 score: SCORE_WEIGHTS.MATCH_TYPE.LIKED_SONG,
                 reason: 'Liked song'
                 // No rank/timeframe for liked songs unless fetched differently
             });
         }

        return matches.sort((a, b) => b.score - a.score); // Return sorted matches
    }


    /**
     * Finds all matches for a player's song based on user's top artists.
     * @param playerSong - Normalized player song data (needs name for feature check, artist/artists field).
     * @param userTracks - User's top tracks (needed for context, maybe future use).
     * @param userArtists - User's top artists across time frames.
     * @returns Array of match results for the artists.
     */
    private findAllArtistMatches(
        playerSong: { name: string; artist: string; spotifyId?: string; artists?: Array<{ name: string; role: string }> },
        userTracks: Record<TimeFrame, NormalizedTrack[]>, // Keep for potential future context
        userArtists: Record<TimeFrame, NormalizedArtist[]>
    ): MatchResult[] {
        const matches: MatchResult[] = [];
        const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
        const matchedArtistDetails = new Map<string, { bestScore: number, rank: number, timeFrame: TimeFrame, role: string, reason: string, details: string }>();

        // 1. Check for Featured Artists in Song Title
        const featureMatches = this.checkForFeatureMatch(playerSong.name, userArtists);
        matches.push(...featureMatches); // Add feature matches directly

        // 2. Check Primary/Listed Artists
         // Prefer structured artists if available, otherwise parse the string
         const artistList = (playerSong.artists && playerSong.artists.length > 0)
             ? playerSong.artists.map(a => ({ name: a.name.toLowerCase(), role: a.role || 'primary' }))
             : playerSong.artist.split(',').map((a, index) => ({ name: a.trim().toLowerCase(), role: index === 0 ? 'primary' : 'featured' }));


        for (const artist of artistList) {
             if (!artist.name) continue; // Skip if artist name is empty

             let bestMatchForThisArtist: { score: number; rank: number; timeFrame: TimeFrame } | null = null;

             for (const timeFrame of timeFrames) {
                 const artistsInTimeframe = userArtists[timeFrame] || [];
                 const matchedUserArtist = artistsInTimeframe.find(userArtist =>
                     userArtist.name && artist.name && userArtist.name === artist.name
                 );

                 if (matchedUserArtist && matchedUserArtist.rank) { // Ensure rank exists
                     const rank = matchedUserArtist.rank;
                     const rankBonuses = SCORE_WEIGHTS.ARTIST_RANK_BONUS[
                          timeFrame === 'short_term' ? 'SHORT_TERM' :
                          timeFrame === 'medium_term' ? 'MEDIUM_TERM' : 'LONG_TERM'
                      ];

                      let rankBonus = 0; // Default
                      for (const tier of rankBonuses) {
                          if (rank <= tier.threshold) {
                              rankBonus = tier.bonus;
                              break;
                          }
                      }

                      const timeFrameBonus = SCORE_WEIGHTS.TIME_FRAME[timeFrame];
                      // Base score depends on primary artist match
                      const baseScore = SCORE_WEIGHTS.MATCH_TYPE.TOP_ARTIST + timeFrameBonus + rankBonus;
                      // Apply multiplier for role (featured artists contribute slightly less)
                      const roleMultiplier = artist.role === 'primary' ? 1.0 : 0.8;
                      const score = baseScore * roleMultiplier;

                      // Keep track of the best score found *for this specific artist* across all timeframes
                      if (!bestMatchForThisArtist || score > bestMatchForThisArtist.score) {
                           bestMatchForThisArtist = { score, rank, timeFrame };
                      }
                 }
             } // End timeframe loop for this artist

             // If a best match was found for this artist, store its details
             if (bestMatchForThisArtist) {
                 const details = `#${bestMatchForThisArtist.rank} ${bestMatchForThisArtist.timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(bestMatchForThisArtist.timeFrame)}`}`;
                  const reason = artist.role === 'primary' ? 'Top artist' : 'Featured artist'; // Reason based on role
                 // Only add if it's better than any existing match for this *same artist name* (handles potential duplicates in list)
                 const existingBest = matchedArtistDetails.get(artist.name);
                 if (!existingBest || bestMatchForThisArtist.score > existingBest.bestScore) {
                    matchedArtistDetails.set(artist.name, {
                        bestScore: bestMatchForThisArtist.score,
                        rank: bestMatchForThisArtist.rank,
                        timeFrame: bestMatchForThisArtist.timeFrame,
                        role: artist.role,
                        reason: reason,
                        details: details
                    });
                 }
             }
        } // End artistList loop

        // 3. Add matches from the collected details map
        matchedArtistDetails.forEach((details) => {
            matches.push({
                 score: details.bestScore,
                 reason: details.reason,
                 details: details.details,
                 rank: details.rank,
                 timeFrame: details.timeFrame
            });
        });


        // 4. Apply Multiple Artist Bonus (if applicable)
        const uniqueMatchedArtistNames = new Set(Array.from(matchedArtistDetails.keys()));
         if (uniqueMatchedArtistNames.size > 1) {
             const sortedMatches = matches
                .filter(m => m.reason.includes('Top artist') || m.reason.includes('Featured artist')) // Only consider artist matches
                .sort((a, b) => b.score - a.score);

             if (sortedMatches.length > 0) {
                 const highestArtistScoreMatchIndex = matches.findIndex(m => m === sortedMatches[0]); // Find index of the best match

                 // Calculate bonus based on the *other* unique artist matches
                 let multipleArtistBonus = 0;
                 let bonusContributingArtists = 0;
                 Array.from(uniqueMatchedArtistNames).forEach((artistName, index) => {
                      if(index > 0) { // Start bonus from the second unique artist
                        const matchDetails = matchedArtistDetails.get(artistName);
                        if(matchDetails) {
                            const qualityFactor = matchDetails.rank <= 25 ? 0.2 : 0.1; // Give more weight to higher-ranked artists
                            multipleArtistBonus += (SCORE_WEIGHTS.MULTIPLE_MATCHES_BONUS * qualityFactor) / index; // Diminishing returns
                            bonusContributingArtists++;
                        }
                      }
                 });


                 if (multipleArtistBonus > 0 && highestArtistScoreMatchIndex !== -1) {
                     matches[highestArtistScoreMatchIndex].score += multipleArtistBonus;
                      // Append bonus reason carefully
                      const bonusReason = `(+${bonusContributingArtists} other artists)`;
                      matches[highestArtistScoreMatchIndex].reason = `${matches[highestArtistScoreMatchIndex].reason.substring(0, 50)}${matches[highestArtistScoreMatchIndex].reason.length > 50 ? '...' : ''} ${bonusReason}`;

                 }
             }
         }


        return matches.sort((a, b) => b.score - a.score); // Return sorted matches
    }


    /**
     * Checks song title for featured artists and compares against user's top artists.
     */
    private checkForFeatureMatch(
        songTitle: string,
        userArtists: Record<TimeFrame, NormalizedArtist[]>
    ): MatchResult[] {
        const matches: MatchResult[] = [];
        if (!songTitle) return matches;

        // Enhanced patterns to capture variations
        const featurePatterns = [
            /\(feat\.?\s+([^)]+)\)/ig,  // Added 'g'
            /\(ft\.?\s+([^)]+)\)/ig,    // Added 'g'
            /\(with\s+([^)]+)\)/ig,     // Added 'g'
            /\bfeat\.?\s+([\w\s&,'-]+)/ig, // Added 'g'
            /\bft\.?\s+([\w\s&,'-]+)/ig,   // Added 'g'
            /\bwith\s+([\w\s&,'-]+)/ig,    // Added 'g'
            /-\s+([\w\s&,'-]+)/ig // Added 'g' - Use cautiously, might match unintended things
       ];
        const featuredArtists = new Set<string>(); // Use a Set to avoid duplicates

        for (const pattern of featurePatterns) {
            const patternMatches = songTitle.matchAll(pattern); // Use matchAll for global-like behavior
            for (const match of patternMatches) {
                if (match && match[1]) {
                    // Split by common separators like ',', '&', ' and '
                     match[1].split(/[,&]|\s+and\s+/i).forEach(artist => {
                         const cleanedArtist = artist.trim().toLowerCase();
                         if (cleanedArtist) { // Avoid adding empty strings
                             featuredArtists.add(cleanedArtist);
                         }
                     });
                }
            }
        }

         if (featuredArtists.size === 0) {
             return matches;
         }

        const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
        featuredArtists.forEach(featuredArtist => {
             let bestMatchForThisFeature: MatchResult | null = null;
             for (const timeFrame of timeFrames) {
                 const artistsInTimeframe = userArtists[timeFrame] || [];
                 const matchedUserArtist = artistsInTimeframe.find(userArtist =>
                     userArtist.name && userArtist.name === featuredArtist // Already lowercase
                 );

                 if (matchedUserArtist && matchedUserArtist.rank) { // Found a match in user's top artists
                     const rank = matchedUserArtist.rank;
                     const timeFrameBonus = SCORE_WEIGHTS.TIME_FRAME[timeFrame];
                     const rankBonuses = SCORE_WEIGHTS.ARTIST_RANK_BONUS[
                         timeFrame === 'short_term' ? 'SHORT_TERM' :
                         timeFrame === 'medium_term' ? 'MEDIUM_TERM' : 'LONG_TERM'
                     ];
                     let rankBonus = 0;
                     for (const tier of rankBonuses) {
                          if (rank <= tier.threshold) {
                              rankBonus = tier.bonus;
                              break;
                          }
                     }

                     const score = SCORE_WEIGHTS.MATCH_TYPE.FEATURE + timeFrameBonus + rankBonus;
                     const details = `Feature #${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}`;
                     const currentMatch: MatchResult = { score, reason: 'Featured artist', details, rank, timeFrame };

                     // Keep only the best match for this specific featured artist across timeframes
                     if (!bestMatchForThisFeature || currentMatch.score > bestMatchForThisFeature.score) {
                          bestMatchForThisFeature = currentMatch;
                     }
                 }
             }
             // Add the best match found for this featured artist (if any) to the main matches list
             if (bestMatchForThisFeature) {
                 matches.push(bestMatchForThisFeature);
             }
        });


        return matches.sort((a, b) => b.score - a.score); // Return sorted feature matches
    }

    /**
     * Calculates the genre match score component.
     */
    private calculateGenreMatchScore(
        userGenres: Array<{ name: string; weight: number }>,
        playerGenres: string[],
        playerArtist: string, // Combined artist string
        artistsWithLikedSongs: Set<string>
    ): MatchResult {
        if (!playerGenres || playerGenres.length === 0 || !userGenres || userGenres.length === 0) {
            return { score: 0, reason: 'No genre data' };
        }

        const playerGenresLower = playerGenres.map(g => g.toLowerCase());
        const exactMatches: Array<{ name: string; weight: number }> = [];
        const similarMatches: Array<{ name: string; weight: number }> = [];

        // Find exact and similar matches
        userGenres.forEach(userGenre => {
            const userGenreLower = userGenre.name.toLowerCase();
            let isExact = false;
            let isSimilar = false;

            for (const playerGenre of playerGenresLower) {
                 if (playerGenre === userGenreLower) {
                     isExact = true;
                     break; // Found exact match for this user genre
                 }
                 if (this.areGenresSimilar(playerGenre, userGenreLower)) {
                     isSimilar = true;
                     // Don't break, keep checking for an exact match potentially
                 }
            }

            if (isExact) {
                exactMatches.push(userGenre);
            } else if (isSimilar) {
                similarMatches.push(userGenre);
            }
        });

        const allMatches = [...exactMatches, ...similarMatches];
        if (allMatches.length === 0) {
            return { score: 0, reason: 'No genre matches' };
        }

        // Calculate weighted score
        const totalWeight = userGenres.reduce((sum, g) => sum + g.weight, 0) || 1;
        const exactMatchWeight = exactMatches.reduce((sum, m) => sum + m.weight, 0);
        const similarMatchWeight = similarMatches.reduce((sum, m) => sum + m.weight, 0);

        // Base score uses exact match bonus internally now
        const weightedMatchScore = (
            (exactMatchWeight * (1 + SCORE_WEIGHTS.EXACT_GENRE_MATCH_BONUS)) +
             similarMatchWeight
        ) / totalWeight;


        // Bonus if the matched genre is in user's top 3
        let topGenreBonus = 0;
        const userTop3GenreNames = userGenres.slice(0, 3).map(g => g.name.toLowerCase());
        const matchesAnyTop3 = allMatches.some(m => userTop3GenreNames.includes(m.name.toLowerCase()));
        if(matchesAnyTop3) {
            topGenreBonus = 0.10; // Flat bonus if any top 3 genre matches (exact or similar)
        }

        // Bonus if user likes/follows the artist associated with these genres
        let artistLikedBonus = 0;
        const artistList = playerArtist.split(',').map(a => a.trim().toLowerCase());
         for (const artistName of artistList) {
             if (artistsWithLikedSongs.has(artistName)) {
                 artistLikedBonus = SCORE_WEIGHTS.GENRE_ARTIST_LIKED_BONUS;
                 break; // Apply bonus once if any artist is liked
             }
         }

        // Final genre score component
        const score = (weightedMatchScore * SCORE_WEIGHTS.MATCH_TYPE.GENRE) + topGenreBonus + artistLikedBonus;

        // Construct Reason and Details
        let reason = '';
        const topMatch = allMatches.sort((a, b) => b.weight - a.weight)[0]; // Get highest weight match
         const isTopMatchExact = exactMatches.some(m => m.name === topMatch.name);

         if (isTopMatchExact) {
            if (weightedMatchScore > 0.7) reason = `Strong exact genre match`;
            else if (weightedMatchScore > 0.4) reason = `Good exact genre match`;
            else reason = `Exact genre match`;
         } else {
            if (weightedMatchScore > 0.7) reason = `Strong genre match`;
            else if (weightedMatchScore > 0.4) reason = `Good genre match`;
            else reason = `Similar genre match`;
         }

        if (artistLikedBonus > 0) {
             reason += ' (+ Artist Liked)';
        }

        // Details: List top 1-2 matching genres
         let details = allMatches
            .sort((a, b) => b.weight - a.weight) // Sort by weight desc
            .slice(0, 2) // Take top 2
            .map(m => m.name)
            .join(', ');

        return { score: Math.min(score, SCORE_WEIGHTS.MATCH_TYPE.GENRE + 0.2), reason, details }; // Cap score slightly above base
    }


    /**
     * Checks if two genre strings are considered similar. Uses caching.
     */
    private areGenresSimilar(genre1: string, genre2: string): boolean {
        const g1 = genre1.toLowerCase().trim();
        const g2 = genre2.toLowerCase().trim();
        if (g1 === g2) return true;

        const cacheKey = g1 < g2 ? `${g1}|${g2}` : `${g2}|${g1}`; // Consistent key order
        if (this.genreSimilarityCache.has(cacheKey)) {
            return this.genreSimilarityCache.get(cacheKey) as boolean;
        }

        // Simple substring check (e.g., "hip hop" vs "east coast hip hop")
        if (g1.includes(g2) || g2.includes(g1)) {
            this.genreSimilarityCache.set(cacheKey, true);
            return true;
        }

        // Predefined similarity groups (expand as needed)
         const groups = [
             ['hip hop', 'rap', 'trap', 'drill', 'hiphop', 'urban contemporary'],
             ['rock', 'metal', 'punk', 'grunge', 'hard rock', 'classic rock', 'alternative rock', 'indie rock', 'alternative'],
             ['pop', 'dance pop', 'electropop', 'indie pop', 'alt z'],
             ['electronic', 'edm', 'house', 'techno', 'trance', 'dance'],
             ['r&b', 'soul', 'funk', 'rnb', 'neo soul'],
             ['country', 'folk', 'bluegrass', 'americana'],
             ['jazz', 'swing', 'blues', 'smooth jazz'],
             ['reggae', 'reggaeton', 'dancehall'],
             ['latin', 'salsa', 'merengue', 'bachata', 'cumbia', 'latin pop', 'regional mexican']
         ];

        let similar = false;
        for (const group of groups) {
            if (group.includes(g1) && group.includes(g2)) {
                similar = true;
                break;
            }
        }

        this.genreSimilarityCache.set(cacheKey, similar);
        return similar;
    }

    /**
     * Helper to get a user-friendly label for a Spotify time frame.
     */
    private getTimeFrameLabel(timeFrame: TimeFrame): string {
        switch (timeFrame) {
            case 'short_term': return 'past 4 weeks';
            case 'medium_term': return 'past 6 months';
            case 'long_term': return 'all time';
            default: return '';
        }
    }

    // Legacy check - likely redundant if checkSongsInLikedTracks is used for scoring
    private checkIfLikedSong(
        playerSong: { name: string; artist: string; spotifyId?: string },
        savedTracksMap: Map<string, boolean> // This map needs to be populated correctly if used
    ): boolean {
        if (playerSong.spotifyId && savedTracksMap.has(playerSong.spotifyId)) return true;
        // Fallback check by name/artist if needed
        const artistList = playerSong.artist.split(',').map(a => a.trim().toLowerCase());
        for (const artistName of artistList) {
            const key = `${playerSong.name}|${artistName}`;
            if (savedTracksMap.has(key)) return true;
        }
        return false;
    }

} // End TeamMatcherService class