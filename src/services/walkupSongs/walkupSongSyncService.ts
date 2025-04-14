// src/services/walkupSongs/walkupSongSyncService.ts
import mongoose from 'mongoose';
import cron from 'node-cron';
import { Player, PlayerDocument } from '@/models/playerModel'; // Use the Mongoose model
import { WalkupDbClient, ApiPlayerDetailResponse, ApiPlayerListItem } from '@/services/walkupDb/walkupDbClient';
import { PlayerWalkupSong } from '@/lib/walkupSongs/types'; // For return type of DB queries
import { PlayerStats } from '@/lib/mlb/types'; // Ensure this type is correctly defined/imported


export class WalkupSongSyncService {
    private static instance: WalkupSongSyncService;
    private isUpdating = false;
    private walkupDbClient: WalkupDbClient;

    private constructor() {
        this.walkupDbClient = WalkupDbClient.getInstance();
        this.initializeMongoDB()
            .then(() => {
                console.log("WalkupSongSyncService: MongoDB Initialized.");
                 // Schedule update *after* successful initialization
                 this.scheduleDailyUpdate();
                 // Optionally run an initial update on startup if desired
                 // this.updatePlayerData().catch(err => console.error("Initial player data update failed:", err));
            })
            .catch(err => {
                console.error("WalkupSongSyncService: Failed to initialize MongoDB. Sync service may not function correctly.", err);
                 // Decide if the application should halt or continue without sync
            });
    }

    public static getInstance(): WalkupSongSyncService {
        if (!WalkupSongSyncService.instance) {
            WalkupSongSyncService.instance = new WalkupSongSyncService();
        }
        return WalkupSongSyncService.instance;
    }

    private async initializeMongoDB(): Promise<void> {
        try {
            if (mongoose.connection.readyState !== 1) { // Check if not already connected
                 console.log('WalkupSongSyncService: Attempting MongoDB connection...');
                 if (!process.env.MONGO_URI) {
                     throw new Error('MONGO_URI environment variable is not set');
                 }
                 await mongoose.connect(process.env.MONGO_URI);
                 console.log('WalkupSongSyncService: MongoDB connected successfully.');
            } else {
                 console.log('WalkupSongSyncService: MongoDB connection already established.');
            }
        } catch (error) {
             console.error('WalkupSongSyncService: MongoDB connection error:', error);
             throw error; // Re-throw to be handled by the caller (constructor)
        }
    }

    private scheduleDailyUpdate() {
        // Schedule to run daily at 3 AM server time
        cron.schedule('0 3 * * *', async () => {
            console.log('WalkupSongSyncService: Starting scheduled player data update...');
             try {
                 await this.updatePlayerData();
                 console.log('WalkupSongSyncService: Scheduled player data update completed successfully.');
             } catch (error) {
                 console.error('WalkupSongSyncService: Error during scheduled player data update:', error);
             }
        }, {
             scheduled: true,
             timezone: "America/Chicago" // Example: Use appropriate timezone
        });
         console.log("WalkupSongSyncService: Daily player data update scheduled for 3:00 AM (America/Chicago).");
    }

    /**
     * Orchestrates the fetching of all players and their details from WalkupDB
     * and updates the local MongoDB database.
     */
    async updatePlayerData(): Promise<void> {
        if (this.isUpdating) {
            console.log('WalkupSongSyncService: Update already in progress. Skipping.');
            return;
        }
        this.isUpdating = true;
        console.log('WalkupSongSyncService: Starting player data update...');
        let updatedCount = 0;
        let createdCount = 0;
        let errorCount = 0;
        let fetchedPlayerList: ApiPlayerListItem[] = [];

        try {
            // 1. Fetch the list of all player IDs from the WalkupDB API
             fetchedPlayerList = await this.walkupDbClient.fetchAllPlayers();
            console.log(`WalkupSongSyncService: Fetched ${fetchedPlayerList.length} player IDs from WalkupDB.`);

             if (fetchedPlayerList.length === 0) {
                 console.warn("WalkupSongSyncService: No players fetched from WalkupDB API. Aborting update.");
                 this.isUpdating = false;
                 return;
             }

            // 2. Fetch details for each player and update/create in MongoDB
            for (const playerListItem of fetchedPlayerList) {
                 if (!playerListItem.id) {
                     console.warn("WalkupSongSyncService: Skipping player list item with no ID.", playerListItem);
                     errorCount++;
                     continue;
                 }
                try {
                     // Fetch details using the client
                     const details = await this.walkupDbClient.fetchPlayerDetails(playerListItem.id);
                     if (details) {
                         const result = await this.savePlayerToMongoDB(details);
                         if (result === 'updated') updatedCount++;
                         if (result === 'created') createdCount++;
                     } else {
                         console.warn(`WalkupSongSyncService: No details fetched for player ID ${playerListItem.id}. Might be 404 or API error.`);
                         errorCount++;
                     }
                } catch (detailError) {
                     console.error(`WalkupSongSyncService: Error processing player ID ${playerListItem.id}:`, detailError);
                     errorCount++;
                     // Continue to next player even if one fails
                }
                // Note: Rate limiting is handled within the WalkupDbClient's methods
            }

            console.log('WalkupSongSyncService: Player data update finished.');
            console.log(`Summary: Created: ${createdCount}, Updated: ${updatedCount}, Errors/Skipped: ${errorCount}`);

        } catch (error) {
            console.error('WalkupSongSyncService: Critical error during player data update process:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Saves or updates a single player's data in MongoDB based on API response.
     * @param playerApiResponse The detailed player data from the WalkupDB API.
     * @returns Promise<'created' | 'updated' | 'skipped' | 'error'> Indicating the outcome.
     */
    private async savePlayerToMongoDB(playerApiResponse: ApiPlayerDetailResponse): Promise<'created' | 'updated' | 'skipped' | 'error'> {
        try {
            const playerData = playerApiResponse.data;

            // Basic validation of incoming data
            if (!playerData?.id || !playerData?.name || !playerData?.mlb_id) {
                 console.warn('WalkupSongSyncService: Skipping save due to invalid player data:', { id: playerData?.id, name: playerData?.name, mlb_id: playerData?.mlb_id });
                 return 'skipped';
            }

            const filter = { id: playerData.id }; // Filter by WalkupDB API ID

            // Prepare the structured song data for MongoDB
            const walkupSongsForDb = (playerData.songs || [])
                .filter(song => song.id && song.title && song.artists?.length > 0) // Ensure essential song data exists
                .map(song => {
                     const artists = song.artists.map((name, index) => ({
                         name: name || 'Unknown',
                         role: (index === 0 ? 'primary' : 'featured') as ('primary' | 'featured')
                     }));
                    return {
                         id: String(song.id), // Ensure ID is string
                         songName: song.title,
                         artistName: song.artists.join(', '), // Keep combined string if needed
                         artists: artists,
                         albumName: '', // API doesn't provide this?
                         spotifyId: song.spotify_id || '', // Handle missing spotify ID
                         youtubeId: '', // API doesn't provide this?
                         genre: [], // Genre needs to be populated separately (e.g., via Spotify lookup later)
                         albumArt: song.spotify_image || '', // Use spotify image if available
                         previewUrl: null // API doesn't provide this?
                    };
                });


             // Prepare the update object, excluding walkupSongs initially
             const updateData = {
                 $set: {
                     mlbId: playerData.mlb_id,
                     name: playerData.name,
                     position: playerData.position || 'Unknown', // Default if missing
                     team: playerData.team?.name || 'Unknown',
                     teamId: playerData.team?.id || 'Unknown', // Use team ID from API if available
                     lastUpdated: new Date(),
                     // Clear existing stats - they should be updated by a separate process (e.g., MySportsFeeds sync)
                     // If this service *is* the source of stats, map them here. Assuming not for now.
                     // stats: mapStatsFromApiResponse(playerData)
                 },
                 // $setOnInsert ensures these fields are only set when a new document is created
                 $setOnInsert: {
                     id: playerData.id, // Set the unique WalkupDB ID only on creation
                     stats: { batting: {}, pitching: {} }, // Initialize stats object on creation
                     walkupSongs: [] // Initialize empty songs array on creation
                 }
             };

             // Perform an upsert operation
             const options = { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true };
             const existingPlayer = await Player.findOneAndUpdate(filter, updateData, options);

            let outcome: 'created' | 'updated' = 'updated'; // Assume updated initially
             if (!existingPlayer || !existingPlayer.walkupSongs) {
                 // This case should ideally not happen with findOneAndUpdate+upsert returning the *new* doc,
                 // but handle defensively. If it was truly inserted, it should have the $setOnInsert values.
                 console.error(`WalkupSongSyncService: Failed to retrieve or initialize player after upsert for ID ${playerData.id}.`);
                 // Attempt a direct find to see if it exists now
                 const checkPlayer = await Player.findOne(filter);
                 if (checkPlayer) {
                     console.warn(`WalkupSongSyncService: Player ${playerData.id} found after check, proceeding with song merge.`);
                     outcome = checkPlayer.createdAt?.getTime() === checkPlayer.updatedAt?.getTime() ? 'created' : 'updated'; // Rough check
                     // Manually merge songs if needed (complex, ideally upsert handles this)
                 } else {
                     console.error(`WalkupSongSyncService: Player ${playerData.id} still not found after upsert!`);
                     return 'error';
                 }
             } else if (existingPlayer.createdAt?.getTime() === existingPlayer.updatedAt?.getTime()) {
                  // If createdAt and updatedAt are the same just after the upsert, it was likely created
                  outcome = 'created';
             }


             // --- Merge Songs ---
             // Get IDs of songs currently in the database for this player
             const existingSongIds = new Set(existingPlayer.walkupSongs.map(s => String(s.id)));
             // Filter API songs to find only the ones *not* already in the database
             const newSongsToAdd = walkupSongsForDb.filter(apiSong => !existingSongIds.has(apiSong.id));

            // Update existing songs with potentially new data (like albumArt or spotifyId if changed)
            const updateOperations = existingPlayer.walkupSongs.map(existingSong => {
                const matchingApiSong = walkupSongsForDb.find(apiSong => String(apiSong.id) === String(existingSong.id));
                if (matchingApiSong) {
                    // Define fields to update if they have changed in the API response
                    const fieldsToUpdate: any = {};
                    if (matchingApiSong.songName !== existingSong.songName) fieldsToUpdate['walkupSongs.$[song].songName'] = matchingApiSong.songName;
                    if (matchingApiSong.artistName !== existingSong.artistName) fieldsToUpdate['walkupSongs.$[song].artistName'] = matchingApiSong.artistName;
                    if (matchingApiSong.spotifyId && matchingApiSong.spotifyId !== existingSong.spotifyId) fieldsToUpdate['walkupSongs.$[song].spotifyId'] = matchingApiSong.spotifyId;
                    if (matchingApiSong.albumArt && matchingApiSong.albumArt !== existingSong.albumArt) fieldsToUpdate['walkupSongs.$[song].albumArt'] = matchingApiSong.albumArt;
                    // Add more fields as needed

                    if (Object.keys(fieldsToUpdate).length > 0) {
                        return Player.updateOne(
                            { _id: existingPlayer._id, 'walkupSongs.id': existingSong.id },
                            { $set: fieldsToUpdate },
                            { arrayFilters: [{ 'song.id': existingSong.id }] }
                        );
                    }
                }
                return Promise.resolve(); // No update needed for this existing song
            });

             await Promise.all(updateOperations);


             // Add the genuinely new songs
             if (newSongsToAdd.length > 0) {
                  console.log(`WalkupSongSyncService: Adding ${newSongsToAdd.length} new songs for player ${playerData.name} (${playerData.id}).`);
                 await Player.updateOne(filter, { $addToSet: { walkupSongs: { $each: newSongsToAdd } } });
                 // Note: $addToSet prevents adding exact duplicates based on the whole subdocument.
                 // If only ID uniqueness is needed, the filtering logic above is the primary guard.
             } else {
                 // console.log(`WalkupSongSyncService: No new songs to add for player ${playerData.name} (${playerData.id}).`); // Optional logging
             }

            // Log outcome
            if (outcome === 'created') {
                 console.log(`WalkupSongSyncService: Successfully created player ${playerData.name} (${playerData.id}) with ${walkupSongsForDb.length} initial songs.`);
             } else {
                 // console.log(`WalkupSongSyncService: Successfully updated player ${playerData.name} (${playerData.id}). Added ${newSongsToAdd.length} songs.`); // Optional logging
             }

            return outcome;

        } catch (error) {
            console.error(`WalkupSongSyncService: Error saving player ${playerApiResponse?.data?.name || 'UNKNOWN'} (ID: ${playerApiResponse?.data?.id}) to MongoDB:`, error);
             if (error instanceof mongoose.Error.ValidationError) {
                 console.error("Validation Errors:", error.errors);
             } else if (error.code === 11000) { // Handle potential duplicate key errors if index isn't perfect
                 console.warn(`WalkupSongSyncService: Duplicate key error likely for player ${playerApiResponse?.data?.id}. Might be a race condition or index issue.`);
                 return 'skipped'; // Treat as skipped if duplicate error occurs
             }
            return 'error';
        }
    }

    // --- Local Database Access Methods ---

    /**
     * Retrieves all players and their walkup songs from the local MongoDB.
     * @returns {Promise<PlayerWalkupSong[]>}
     */
    async getAllPlayersFromDb(): Promise<PlayerWalkupSong[]> {
        try {
            const players = await Player.find({});
            return players.map(this.mapDocumentToPlayerWalkupSong);
        } catch (error) {
            console.error('WalkupSongSyncService: Error fetching players from MongoDB:', error);
            return [];
        }
    }

    /**
     * Retrieves a specific player by their WalkupDB ID from the local MongoDB.
     * @param {string} playerId WalkupDB ID
     * @returns {Promise<PlayerWalkupSong | null>}
     */
    async getPlayerByIdFromDb(playerId: string): Promise<PlayerWalkupSong | null> {
        try {
            const player = await Player.findOne({ id: playerId });
            return player ? this.mapDocumentToPlayerWalkupSong(player) : null;
        } catch (error) {
            console.error(`WalkupSongSyncService: Error fetching player ${playerId} from MongoDB:`, error);
            return null;
        }
    }

    /**
     * Retrieves players by team ID (abbreviation) from the local MongoDB.
     * @param {string} teamId Team abbreviation (e.g., 'DET')
     * @returns {Promise<PlayerWalkupSong[]>}
     */
    async getPlayersByTeamFromDb(teamId: string): Promise<PlayerWalkupSong[]> {
        try {
            // Case-insensitive search for teamId
            const players = await Player.find({ teamId: new RegExp(`^${teamId}$`, 'i') });
            return players.map(this.mapDocumentToPlayerWalkupSong);
        } catch (error) {
            console.error(`WalkupSongSyncService: Error fetching players for team ${teamId} from MongoDB:`, error);
            return [];
        }
    }

    /**
     * Retrieves players by position from the local MongoDB.
     * @param {string} position Player position (e.g., 'SS', 'P')
     * @returns {Promise<PlayerWalkupSong[]>}
     */
    async getPlayersByPositionFromDb(position: string): Promise<PlayerWalkupSong[]> {
        try {
             // Case-insensitive search for position
            const players = await Player.find({ position: new RegExp(`^${position}$`, 'i') });
            return players.map(this.mapDocumentToPlayerWalkupSong);
        } catch (error) {
            console.error(`WalkupSongSyncService: Error fetching players for position ${position} from MongoDB:`, error);
            return [];
        }
    }

    /**
     * Retrieves players whose walkup songs include a specific genre.
     * @param {string} genre Genre to search for.
     * @returns {Promise<PlayerWalkupSong[]>}
     */
     async getPlayersByGenreFromDb(genre: string): Promise<PlayerWalkupSong[]> {
        try {
            // Case-insensitive search within the genre array
            const players = await Player.find({ 'walkupSongs.genre': new RegExp(genre, 'i') });
            return players.map(this.mapDocumentToPlayerWalkupSong);
        } catch (error) {
            console.error(`WalkupSongSyncService: Error fetching players by genre '${genre}' from MongoDB:`, error);
            return [];
        }
    }

    /**
     * Helper function to map a Mongoose PlayerDocument to the PlayerWalkupSong type.
     * @param {PlayerDocument} playerDoc Mongoose document.
     * @returns {PlayerWalkupSong} Mapped object.
     */
    private mapDocumentToPlayerWalkupSong(playerDoc: PlayerDocument): PlayerWalkupSong {
         // Map the subdocuments, providing defaults if necessary
        const walkupSongs = (playerDoc.walkupSongs || []).map(song => ({
            id: song.id || 'unknown-song-id', // Provide default ID if missing
            songName: song.songName || 'Unknown Song',
            artistName: song.artistName || 'Unknown Artist',
            artists: song.artists?.length > 0 ? song.artists : [{ name: 'Unknown Artist', role: 'primary' as const }],
            albumName: song.albumName || '',
            spotifyId: song.spotifyId || '',
            youtubeId: song.youtubeId || '',
            genre: song.genre || [],
            albumArt: song.albumArt || '',
            previewUrl: song.previewUrl || null
        }));

        // Ensure PlayerStats structure, providing defaults if missing
        const stats: PlayerStats = {
            batting: {
                battingAvg: playerDoc.stats?.batting?.battingAvg ?? 0,
                onBasePercentage: playerDoc.stats?.batting?.onBasePercentage ?? 0,
                sluggingPercentage: playerDoc.stats?.batting?.sluggingPercentage ?? 0,
                plateAppearances: playerDoc.stats?.batting?.plateAppearances ?? 0,
            },
            pitching: {
                earnedRunAvg: playerDoc.stats?.pitching?.earnedRunAvg ?? 0,
                inningsPitched: playerDoc.stats?.pitching?.inningsPitched ?? 0,
            }
        };


        return {
            playerId: playerDoc.id,
            playerName: playerDoc.name,
            position: playerDoc.position,
            team: playerDoc.team,
            teamId: playerDoc.teamId,
            walkupSongs: walkupSongs, // Assign the mapped songs array
            stats: stats,
            // These fields are added during matching, not stored directly on the player model
            // matchReason: playerDoc.matchReason,
            // rankInfo: playerDoc.rankInfo,
            // matchScore: playerDoc.matchScore,
        };
    }
}

// Optional: Initialize singleton on module load if desired for non-request-based usage
// WalkupSongSyncService.getInstance();