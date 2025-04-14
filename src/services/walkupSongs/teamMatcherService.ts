// src/services/walkupSongs/teamMatcherService.ts
import { PlayerWalkupSong, WalkupSong } from '@/lib/walkupSongs/types'; // Adjusted path if needed
import { SpotifyGenreSummary, SpotifyTopItem, SpotifyService } from '@/services/spotify/spotifyService';
import { Position, PlayerStats } from '@/lib/mlb/types'; // Adjusted path if needed
import { TeamStatsModel } from '@/models/teamStatsModel';
import {
    NormalizedTrack, NormalizedArtist, MatchResult, PlayerWithScore, SongMatchDetails, TeamAssignment, TimeFrame
} from '@/lib/walkupSongs/matchingTypes'; // Use centralized types
import {
    SCORE_WEIGHTS, COMPATIBLE_POSITIONS, SIMILAR_POSITIONS, FALLBACK_POSITIONS, POSITION_WEIGHTS, MIN_MATCH_SCORE,
    MULTIPLE_SONG_BONUS, DIVERSITY_THRESHOLD, DIVERSITY_BOOST_AMOUNT, NUM_USER_TOP_GENRES,
    MIN_GAMES_PLAYED_THRESHOLD, HITTER_PA_PER_GAME_THRESHOLD, PITCHER_IP_PER_GAME_THRESHOLD
} from '@/config/matchingConfig'; // Use centralized config
import axios from 'axios'; // Needed for liked track check

export class TeamMatcherService {
    private spotifyService: SpotifyService;
    private usedArtistsMap: Map<string, number>; // Renamed for clarity
    private genreSimilarityCache: Map<string, boolean>;
    private tigersGamesPlayed: number | null = null; // Cache for team games played

    constructor(spotifyService: SpotifyService) {
        this.spotifyService = spotifyService;
        this.usedArtistsMap = new Map();
        this.genreSimilarityCache = new Map();
    }

    /**
     * Main method to find a team based on user preferences and player data.
     */
    async findTeamByPreferences(
        userGenres: SpotifyGenreSummary[],
        userTopTracks: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
        userTopArtists: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
        userSavedTracks: SpotifyTopItem[], // Currently used only for liked artist bonus in genre matching
        positions: Position[],
        allPlayerSongsFromDb: PlayerWalkupSong[], // Expects data from WalkupSongSyncService.getAllPlayersFromDb()
        accessToken: string // Needed for checkSongsInLikedTracks
    ): Promise<PlayerWalkupSong[]> { // Returns the final team structure

        console.log("TeamMatcherService: Starting findTeamByPreferences...");

        // 1. Fetch Validation Data (Team Games Played) - Cached locally for this run
        if (this.tigersGamesPlayed === null) { // Fetch only if not already fetched
        try {
                const teamStats = await TeamStatsModel.findOne({ teamId: 'det' }); // Example for Tigers
                this.tigersGamesPlayed = teamStats ? teamStats.gamesPlayed : MIN_GAMES_PLAYED_THRESHOLD;
            console.log(`TeamMatcherService: Using Tigers games played for validation: ${this.tigersGamesPlayed}`);
        } catch (error) {
                console.error('TeamMatcherService: Error fetching team games played, using default:', error);
            this.tigersGamesPlayed = MIN_GAMES_PLAYED_THRESHOLD;
            }
        }

        // 2. Reset State for this matching run
        this.usedArtistsMap.clear();
        this.genreSimilarityCache.clear();
        // Note: usedSongs set removed as duplicate song penalty wasn't fully implemented/needed

        // 3. Initialize Diversity Boost Logic
        const userTopNGenres = new Set(
            userGenres.slice(0, NUM_USER_TOP_GENRES).map(g => g.name.toLowerCase())
        );
        const teamGenreCounts: Map<string, number> = new Map();

        // 4. Filter Players by Stats and Valid Walkup Song
        console.log(`TeamMatcherService: Initial player count from DB: ${allPlayerSongsFromDb.length}`);
        const validPlayers = allPlayerSongsFromDb.filter(player => {
            const hasValidWalkupSong = player.walkupSongs && player.walkupSongs.length > 0 &&
                player.walkupSongs[0].songName && player.walkupSongs[0].artists?.length > 0 && // Check artists array too
                player.walkupSongs[0].songName !== 'No walkup song' && player.walkupSongs[0].songName !== 'Unknown Song';

             if (!hasValidWalkupSong) return false;
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

        // 6. Perform Liked Track Check
        let likedTrackIdSet = new Set<string>();
        if (uniqueSpotifyIdsArray.length > 0) {
            try {
                const likedStatusArray = await this.checkSongsInLikedTracks(uniqueSpotifyIdsArray, accessToken);
                uniqueSpotifyIdsArray.forEach((id, index) => {
                    if (likedStatusArray[index]) likedTrackIdSet.add(id);
                });
                console.log(`TeamMatcherService: Found ${likedTrackIdSet.size} liked songs among the checked IDs.`);
            } catch (error) {
                console.error("TeamMatcherService: Failed to perform batch check for liked songs, proceeding without liked song data:", error);
            }
        }

        // 7. Normalize User Preferences
        const userTopGenresNormalized = userGenres.slice(0, 10).map(g => ({
            name: g.name.toLowerCase(), weight: g.weight
        }));
        const normalizedUserTracks = this.normalizeUserTracks(userTopTracks);
        const normalizedUserArtists = this.normalizeUserArtists(userTopArtists);
        const artistsWithLikedSongs = this.getArtistsWithLikedSongs(normalizedUserTracks, normalizedUserArtists, likedTrackIdSet);

        // 8. Calculate Match Scores for All Valid Players
        const playersWithScoresPromises: Promise<PlayerWithScore>[] = validPlayers.map(async (player): Promise<PlayerWithScore> => {
             if (!player.walkupSongs || player.walkupSongs.length === 0) {
                 return { player, matchScore: 0, originalMatchScore: 0, matchReason: 'No valid walkup songs', rankInfo: '', matchingSongs: [] };
             }

             // Evaluate each song the player has
             const songMatchDetailsPromises: Promise<SongMatchDetails>[] = player.walkupSongs.map(async (song) => {
                 const normalizedPlayerSong = {
                     name: song.songName.toLowerCase(),
                    // artist: song.artistName.toLowerCase(), // No longer using this string here
                     spotifyId: song.spotifyId || '',
                     genres: (song.genre || []).map(g => g.toLowerCase()),
                    artists: song.artists?.map(a => ({ // Pass structured artists
                        name: a.name.toLowerCase(),
                        role: a.role || 'primary' // Default role if missing
                    })) || [{ name: 'unknown', role: 'primary' }] // Provide default if array missing
                };

                const songMatches = await this.findAllSongMatches(normalizedPlayerSong, normalizedUserTracks, likedTrackIdSet);
                const artistMatches = this.findAllArtistMatches(normalizedPlayerSong, normalizedUserArtists); // Pass structured artists
                const genreMatch = this.calculateGenreMatchScore(userTopGenresNormalized, normalizedPlayerSong.genres, normalizedPlayerSong.artists, artistsWithLikedSongs); // Pass structured artists

                 const potentialMatches = [
                    { type: 'Song', ...(songMatches.sort((a, b) => b.score - a.score)[0] || { score: 0 }) },
                    { type: 'Artist', ...(artistMatches.sort((a, b) => b.score - a.score)[0] || { score: 0 }) },
                     { type: 'Genre', ...genreMatch }
                ].filter(m => m.score > 0.001).sort((a, b) => b.score - a.score);

                 let finalCombinedScore = 0;
                 let finalReason = 'No Match';
                 let finalDetails = '';

                 if (potentialMatches.length > 0) {
                     const primaryMatch = potentialMatches[0];
                     const sumOfOtherScores = potentialMatches.slice(1).reduce((sum, match) => sum + (match.score || 0), 0);
                     finalCombinedScore = (primaryMatch.score || 0) + (0.05 * sumOfOtherScores);

                     finalReason = primaryMatch.reason || primaryMatch.type || 'Unknown Match';
                     finalDetails = primaryMatch.details || '';
                     if (sumOfOtherScores > 0.001 && potentialMatches.length > 1) {
                          const otherReasons = potentialMatches.slice(1).map(m => m.reason || m.type).join(', ');
                          const bonusReason = `+ bonus (${otherReasons.substring(0, 30)}${otherReasons.length > 30 ? '...' : ''})`;
                          finalReason = `${finalReason.substring(0,40)}${finalReason.length > 40 ? '...' : ''} ${bonusReason}`;
                     }
                 }

                 return {
                     songName: song.songName,
                    artists: song.artists || [], // Return structured artists
                     matchScore: finalCombinedScore,
                     matchReason: finalReason,
                     rankInfo: finalDetails,
                    albumArt: song.albumArt || this.spotifyService.getDefaultAlbumArt(),
                    previewUrl: song.previewUrl || null,
                     spotifyId: song.spotifyId
                 };
            });

             const evaluatedSongs = await Promise.all(songMatchDetailsPromises);

              const bestSongResult = evaluatedSongs.reduce(
                  (best, current) => (current.matchScore > best.matchScore ? current : best),
                { matchScore: 0, matchReason: 'N/A', rankInfo: '', artists: [] } // Initial best includes artists
              );

             const basePlayerScore = bestSongResult.matchScore;
             const statsBonus = this.calculateStatsBonus(player);
             const finalPlayerScore = basePlayerScore + statsBonus;

             return {
                 player,
                 matchScore: finalPlayerScore,
                 originalMatchScore: finalPlayerScore,
                 matchReason: bestSongResult.matchReason,
                 rankInfo: bestSongResult.rankInfo,
                matchingSongs: evaluatedSongs.filter(s => s.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore)
             };
        });

        const playersWithScoresResolved: PlayerWithScore[] = await Promise.all(playersWithScoresPromises);

        // 9. Filter out players below minimum score and initial sort
        const candidatePool = playersWithScoresResolved
            .filter(p => p.matchScore >= MIN_MATCH_SCORE)
            .sort((a, b) => b.matchScore - a.matchScore);

         if (candidatePool.length === 0) {
             console.warn("TeamMatcherService: No players met the minimum match score. Cannot generate team.");
             return [];
         }
         console.log(`TeamMatcherService: Starting team selection with ${candidatePool.length} candidates.`);

        // 10. Team Selection Loop
         const team: { [position: string]: TeamAssignment } = {};
        const usedCandidateIds = new Set<string>();

         for (const targetPosition of positions) {
             const eligibleCandidates = candidatePool.filter(candidate =>
                 this.isCandidateEligibleForPosition(candidate, targetPosition) &&
                 !usedCandidateIds.has(candidate.player.playerId)
             );

             console.log(`\nTeamMatcherService: Processing Position: ${targetPosition}. Eligible Candidates: ${eligibleCandidates.length}`);
              if(eligibleCandidates.length === 0) {
                  console.log(` -> No eligible candidates found.`);
                 continue;
              }

             const candidatesWithBoost = eligibleCandidates.map(candidate => {
                 let diversityBoost = 0;
                 let contributingGenre: string | null = null;
                const bestSongMatch = candidate.matchingSongs[0]; // Assumes sorted
                  let songGenres: string[] = [];
                  if (bestSongMatch) {
                    const walkupSongData = candidate.player.walkupSongs?.find(ws => ws.id === bestSongMatch.spotifyId); // Match via spotifyId if possible, or name/artist as fallback
                      songGenres = walkupSongData?.genre?.map(g => g.toLowerCase()) || [];
                  }

                 for (const genre of songGenres) {
                     if (userTopNGenres.has(genre)) {
                         const currentGenreCount = teamGenreCounts.get(genre) || 0;
                         if (currentGenreCount < DIVERSITY_THRESHOLD) {
                             diversityBoost = DIVERSITY_BOOST_AMOUNT;
                             contributingGenre = genre;
                             break;
                         }
                     }
                 }
                 return {
                     ...candidate,
                     scoreForSorting: candidate.matchScore + diversityBoost,
                     boostingGenre: contributingGenre
                 };
             });

             const sortedEligible = candidatesWithBoost.sort((a, b) => (b.scoreForSorting ?? 0) - (a.scoreForSorting ?? 0));

             let candidateSelected = false;
             for (const candidate of sortedEligible) {
                 if (usedCandidateIds.has(candidate.player.playerId)) continue;

                // Use primary artist for penalty check
                const primaryArtist = candidate.player.walkupSongs?.[0]?.artists?.find(a => a.role === 'primary');
                const primaryArtistKey = primaryArtist?.name?.toLowerCase() || 'unknown_artist';

                  const artistOccurrences = this.usedArtistsMap.get(primaryArtistKey) || 0;
                  const penaltyMultiplier = this.computePenaltyMultiplier(artistOccurrences);
                  const scoreAfterPenalty = candidate.matchScore * (1 - penaltyMultiplier);

                 if (scoreAfterPenalty >= MIN_MATCH_SCORE) {
                     console.log(` -> Selected ${candidate.player.playerName} for ${targetPosition} (Score: ${candidate.matchScore.toFixed(3)}, Adjusted: ${scoreAfterPenalty.toFixed(3)}, BoostedForSort: ${candidate.scoreForSorting?.toFixed(3)}, PenaltyMult: ${penaltyMultiplier.toFixed(2)})`);
                     team[targetPosition] = { candidate, assignedPosition: targetPosition };
                     usedCandidateIds.add(candidate.player.playerId);
                     this.usedArtistsMap.set(primaryArtistKey, artistOccurrences + 1);

                    // Update genre counts
                      let genreToCount: string | null = null;
                    const selectedWalkupSong = candidate.player.walkupSongs?.find(ws => ws.id === candidate.matchingSongs[0].spotifyId); // Use best match
                      const selectedSongGenres = selectedWalkupSong?.genre?.map(g => g.toLowerCase()) || [];
                      for(const g of selectedSongGenres) {
                         if (userTopNGenres.has(g)) { genreToCount = g; break; }
                    }
                    if (!genreToCount && selectedSongGenres.length > 0) { genreToCount = selectedSongGenres[0]; }
                      if (genreToCount) {
                          const newCount = (teamGenreCounts.get(genreToCount) || 0) + 1;
                          teamGenreCounts.set(genreToCount, newCount);
                          console.log(` -> Team genre count updated: ${genreToCount} = ${newCount}`);
                      }

                     candidateSelected = true;
                     break;
                 }
            }

             if (!candidateSelected) {
                  console.log(` -> Could not find suitable candidate for position ${targetPosition} after applying penalties/uniqueness checks.`);
             }
        } // End position loop

        // 11. Build Final Team Array (adjust mapping if PlayerWalkupSong structure changed)
        const finalTeamResult: PlayerWalkupSong[] = positions
            .map(pos => team[pos])
            .filter((assignment): assignment is TeamAssignment => assignment !== undefined)
            .map(assignment => ({
                ...assignment.candidate.player, // Spread original player data
                position: assignment.assignedPosition, // Override with assigned position
                // Keep match details from the candidate object
                matchScore: assignment.candidate.matchScore,
                 matchReason: assignment.candidate.matchReason,
                 rankInfo: assignment.candidate.rankInfo,
                matchingSongs: assignment.candidate.matchingSongs
            }));

        console.log(`TeamMatcherService: Team generation complete. Final team size: ${finalTeamResult.length}`);
        console.log("TeamMatcherService: Final team genre distribution:", Object.fromEntries(teamGenreCounts));
        return finalTeamResult;

    } // End findTeamByPreferences

    // --- Helper Methods --- (Keep all helper methods like calculateStatsBonus, validatePlayerStats, isCandidateEligible, computePenaltyMultiplier, findAllSongMatches, findAllArtistMatches, calculateGenreMatchScore, areGenresSimilar, getTimeFrameLabel, checkSongsInLikedTracks, etc., adapting them slightly if needed to use the structured 'artists' array instead of 'artistName' string where appropriate)

    // Example adaptation for calculateGenreMatchScore signature:
    private calculateGenreMatchScore(
        userGenres: Array<{ name: string; weight: number }>,
        playerGenres: string[],
        playerArtists: Array<{ name: string; role: 'primary' | 'featured' }>, // Use structured artists
        artistsWithLikedSongs: Set<string>
    ): MatchResult {
         if (!playerGenres || playerGenres.length === 0 || !userGenres || userGenres.length === 0) {
             return { score: 0, reason: 'No genre data' };
         }
         // ... rest of existing logic ...

         // Modify bonus check to use the structured array
         let artistLikedBonus = 0;
         for (const artist of playerArtists) {
             if (artistsWithLikedSongs.has(artist.name.toLowerCase())) {
                 artistLikedBonus = SCORE_WEIGHTS.GENRE_ARTIST_LIKED_BONUS;
                 break;
             }
         }
         // ... rest of existing logic ...
         const score = (weightedMatchScore * SCORE_WEIGHTS.MATCH_TYPE.GENRE) + topGenreBonus + artistLikedBonus;
         // ... reason/details generation ...
         return { score: Math.min(score, SCORE_WEIGHTS.MATCH_TYPE.GENRE + 0.2), reason, details };
    }

    // Example adaptation for findAllArtistMatches signature:
    private findAllArtistMatches(
        playerSong: { name: string; spotifyId?: string; artists: Array<{ name: string; role: string }> }, // Use artists array
        userArtists: Record<TimeFrame, NormalizedArtist[]>
    ): MatchResult[] {
        const matches: MatchResult[] = [];
        const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
        const matchedArtistDetails = new Map<string, { bestScore: number, rank: number, timeFrame: TimeFrame, role: string, reason: string, details: string }>();

        // 1. Feature check (can remain as is, parses title)
        const featureMatches = this.checkForFeatureMatch(playerSong.name, userArtists);
        matches.push(...featureMatches);

        // 2. Check Primary/Listed Artists from the structured array
        const artistList = playerSong.artists || []; // Use the provided structured array

        for (const artist of artistList) {
            if (!artist.name) continue;
            const artistNameLower = artist.name.toLowerCase();
             let bestMatchForThisArtist: { score: number; rank: number; timeFrame: TimeFrame } | null = null;

             for (const timeFrame of timeFrames) {
                 const artistsInTimeframe = userArtists[timeFrame] || [];
                 const matchedUserArtist = artistsInTimeframe.find(userArtist =>
                     userArtist.name && artistNameLower && userArtist.name === artistNameLower // Compare normalized names
                 );

                 if (matchedUserArtist?.rank) {
                    // ... calculate score using rank, timeframe, ARTIST_RANK_BONUS ...
                     const rank = matchedUserArtist.rank;
                    const rankBonuses = SCORE_WEIGHTS.ARTIST_RANK_BONUS[ /* ... get correct timeframe bonus array ... */ ];
                    let rankBonus = 0;
                    for (const tier of rankBonuses) { if (rank <= tier.threshold) { rankBonus = tier.bonus; break; } }
                      const timeFrameBonus = SCORE_WEIGHTS.TIME_FRAME[timeFrame];
                      const baseScore = SCORE_WEIGHTS.MATCH_TYPE.TOP_ARTIST + timeFrameBonus + rankBonus;
                    const roleMultiplier = artist.role === 'primary' ? 1.0 : 0.8; // Use role from input
                      const score = baseScore * roleMultiplier;

                      if (!bestMatchForThisArtist || score > bestMatchForThisArtist.score) {
                           bestMatchForThisArtist = { score, rank, timeFrame };
                      }
                 }
            } // End timeframe loop

             if (bestMatchForThisArtist) {
                 const details = `#${bestMatchForThisArtist.rank} ${bestMatchForThisArtist.timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(bestMatchForThisArtist.timeFrame)}`}`;
                 const reason = artist.role === 'primary' ? 'Top artist' : 'Featured artist'; // Use role
                 const existingBest = matchedArtistDetails.get(artistNameLower);
                 if (!existingBest || bestMatchForThisArtist.score > existingBest.bestScore) {
                      matchedArtistDetails.set(artistNameLower, {
                          bestScore: bestMatchForThisArtist.score, rank: bestMatchForThisArtist.rank, timeFrame: bestMatchForThisArtist.timeFrame,
                          role: artist.role, reason: reason, details: details
                    });
                 }
             }
        } // End artistList loop

        // 3. Add final matches from map
        matchedArtistDetails.forEach((details) => {
             matches.push({ score: details.bestScore, reason: details.reason, details: details.details, rank: details.rank, timeFrame: details.timeFrame });
         });

        // 4. Apply Multiple Artist Bonus (logic can likely remain similar, uses matchedArtistDetails map)
        // ...

         return matches.sort((a, b) => b.score - a.score);
     }


     // --- Need implementations for all other helper methods used above ---
     // calculateStatsBonus, validatePlayerStats, isCandidateEligibleForPosition,
     // computePenaltyMultiplier, findAllSongMatches, checkForFeatureMatch,
     // areGenresSimilar, getTimeFrameLabel, checkSongsInLikedTracks,
     // normalizeUserTracks, normalizeUserArtists, getArtistsWithLikedSongs

     // Example implementations (ensure these match your original logic, adapted for types)
        private normalizeUserTracks(userTopTracks: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] }): Record<TimeFrame, NormalizedTrack[]> {
            const normalized: Record<TimeFrame, NormalizedTrack[]> = { short_term: [], medium_term: [], long_term: [] };
            (['short_term', 'medium_term', 'long_term'] as TimeFrame[]).forEach(tf => {
                normalized[tf] = (userTopTracks[tf] || []).map((track, index) => ({
                    name: track.name?.toLowerCase() || '',
                    artist: track.artists?.[0]?.name?.toLowerCase() || '', // Primary artist
                    spotifyId: track.id,
                    albumId: track.album?.id,
                    albumName: track.album?.name || '',
                    rank: index + 1,
                    timeFrame: tf
                }));
            });
            return normalized;
        }

        private normalizeUserArtists(userTopArtists: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] }): Record<TimeFrame, NormalizedArtist[]> {
             const normalized: Record<TimeFrame, NormalizedArtist[]> = { short_term: [], medium_term: [], long_term: [] };
            (['short_term', 'medium_term', 'long_term'] as TimeFrame[]).forEach(tf => {
                 normalized[tf] = (userTopArtists[tf] || []).map((artist, index) => ({
                     name: artist.name?.toLowerCase() || '',
                     id: artist.id,
                     rank: index + 1,
                     timeFrame: tf
                 }));
             });
             return normalized;
        }

        private getArtistsWithLikedSongs(
            normalizedUserTracks: Record<TimeFrame, NormalizedTrack[]>,
            normalizedUserArtists: Record<TimeFrame, NormalizedArtist[]>,
            likedTrackIdSet: Set<string>
        ): Set<string> {
             const artists = new Set<string>();
             likedTrackIdSet.forEach(trackId => {
                 for (const tf of ['short_term', 'medium_term', 'long_term'] as TimeFrame[]) {
                     const track = normalizedUserTracks[tf].find(t => t.spotifyId === trackId);
                     if (track?.artist) {
                         artists.add(track.artist);
                              break;
                     }
                 }
             });
             for (const tf of ['short_term', 'medium_term', 'long_term'] as TimeFrame[]) {
                normalizedUserArtists[tf].forEach(artist => artists.add(artist.name));
            }
             return artists;
        }

        // Add placeholders or full implementations for other private methods...
        private calculateStatsBonus(player: PlayerWalkupSong): number { /* ... implementation ... */ return 0.01; }
        private validatePlayerStats(player: PlayerWalkupSong): boolean { /* ... implementation ... */ return true; }
        private isCandidateEligibleForPosition(candidate: PlayerWithScore, position: Position): boolean { /* ... implementation ... */ return true; }
        private computePenaltyMultiplier(index: number): number { /* ... implementation ... */ return SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.FIRST; }
        private async findAllSongMatches(playerSong: any, userTracks: any, likedTrackIdSet: any): Promise<MatchResult[]> { /* ... implementation ... */ return []; }
        private checkForFeatureMatch(songTitle: string, userArtists: any): MatchResult[] { /* ... implementation ... */ return []; }
        private areGenresSimilar(genre1: string, genre2: string): boolean { /* ... implementation ... */ return false; }
        private getTimeFrameLabel(timeFrame: TimeFrame): string { /* ... implementation ... */ return timeFrame; }
        private async checkSongsInLikedTracks(spotifyIds: string[], accessToken: string): Promise<boolean[]> {
             // Copied from original service for completeness
            if (!spotifyIds || spotifyIds.length === 0 || spotifyIds.every(id => !id)) return spotifyIds.map(() => false);
            const validIds = spotifyIds.filter(id => id && typeof id === 'string');
            if (validIds.length === 0) return spotifyIds.map(() => false);

            try {
                const batchSize = 50;
                const resultsMap = new Map<string, boolean>();
                for (let i = 0; i < validIds.length; i += batchSize) {
                    const batch = validIds.slice(i, i + batchSize);
                    const apiUrl = `https://api.spotify.com/v1/me/tracks/contains?ids=${batch.join(',')}`;
                    const response = await axios.get<boolean[]>(apiUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                    if (response.data && Array.isArray(response.data) && response.data.length === batch.length) {
                        batch.forEach((id, index) => resultsMap.set(id, response.data[index]));
                    } else {
                        console.error('Unexpected response format from Spotify /me/tracks/contains:', response.data);
                        batch.forEach(id => resultsMap.set(id, false));
                    }
                }
                return spotifyIds.map(id => resultsMap.get(id) ?? false);
            } catch (error) {
                console.error('Error checking songs in liked tracks:', error instanceof Error ? error.message : error);
                 if (axios.isAxiosError(error) && error.response) { console.error('Spotify API Error:', error.response.status, error.response.data); }
                return spotifyIds.map(() => false);
            }
         }

} // End TeamMatcherService