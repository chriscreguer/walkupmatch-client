// src/services/walkupSongs/walkupSongSyncService.ts
import mongoose from 'mongoose';
import cron from 'node-cron';
import { Player, PlayerDocument, WalkupSongSubdocument } from '@/models/playerModel';
import { WalkupDbClient, ApiPlayerDetailResponse, ApiPlayerListItem } from '@/services/walkupDb/walkupDbClient';
import { PlayerWalkupSong } from '@/lib/walkupSongs/types'; // For return type mapping

export class WalkupSongSyncService {
    private static instance: WalkupSongSyncService;
    private walkupDbClient: WalkupDbClient;
    private isUpdating = false;
    private readonly RATE_LIMIT_DELAY = 1000; // Delay for WalkupDB API

    private constructor() {
        this.walkupDbClient = WalkupDbClient.getInstance(); // Use the dedicated client
        this.initializeMongoDB();
                 this.scheduleDailyUpdate();
    }

    public static getInstance(): WalkupSongSyncService {
        if (!WalkupSongSyncService.instance) {
            WalkupSongSyncService.instance = new WalkupSongSyncService();
        }
        return WalkupSongSyncService.instance;
    }

    private async initializeMongoDB(): Promise<void> {
        try {
                 if (!process.env.MONGO_URI) {
                     throw new Error('MONGO_URI environment variable is not set');
                 }
            if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
                console.log('WalkupSongSyncService: Attempting MongoDB connection...');
                 await mongoose.connect(process.env.MONGO_URI);
                 console.log('WalkupSongSyncService: MongoDB connected successfully.');
            } else {
                 console.log('WalkupSongSyncService: MongoDB connection already established.');
            }
        } catch (error) {
             console.error('WalkupSongSyncService: MongoDB connection error:', error);
            // Consider how to handle persistent connection failures
        }
    }

    private scheduleDailyUpdate(): void {
        // Schedule to run daily at 3 AM (or your preferred time)
        cron.schedule('0 3 * * *', async () => {
            console.log('WalkupSongSyncService: Starting scheduled player data update...');
                 await this.updatePlayerData();
        }, {
             scheduled: true,
            timezone: "America/Chicago" // Example timezone
        });
        console.log("WalkupSongSyncService: Daily update job scheduled.");
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetches all players from WalkupDB API and updates local MongoDB.
     */
    public async updatePlayerData(): Promise<void> {
        if (this.isUpdating) {
            console.log('WalkupSongSyncService: Update already in progress, skipping.');
            return;
        }
        this.isUpdating = true;
        console.log('WalkupSongSyncService: Starting player data update...');
        try {
            await this.initializeMongoDB(); // Ensure connection before starting

            const playersFromApi: ApiPlayerListItem[] = await this.walkupDbClient.fetchAllPlayers();
            console.log(`WalkupSongSyncService: Found ${playersFromApi.length} players from API to process.`);

        let updatedCount = 0;
        let createdCount = 0;
        let errorCount = 0;

            for (const playerItem of playersFromApi) {
                try {
                    const details = await this.walkupDbClient.fetchPlayerDetails(playerItem.id); // Use client
                     if (details) {
                         const result = await this.savePlayerToMongoDB(details);
                        if (result === 'created') createdCount++;
                         if (result === 'updated') updatedCount++;
                     } else {
                         errorCount++;
                     }
                    // Use the client's built-in rate limiting, no extra delay needed here
                } catch (playerError) {
                    console.error(`WalkupSongSyncService: Error processing player ID ${playerItem.id}:`, playerError);
                     errorCount++;
                }
            }
            console.log(`WalkupSongSyncService: Player data update complete. Updated: ${updatedCount}, Created: ${createdCount}, Errors: ${errorCount}`);
        } catch (error) {
            console.error('WalkupSongSyncService: Fatal error during player data update:', error);
        } finally {
            this.isUpdating = false;
            // Optional: Disconnect if run as a standalone script, otherwise keep connection open for server
            // await mongoose.disconnect();
        }
    }

    /**
     * Saves or updates a single player's data in MongoDB based on API response.
     * Incorporates fixes for artists array and genre preservation.
     */
    private async savePlayerToMongoDB(apiResponse: ApiPlayerDetailResponse): Promise<'created' | 'updated' | 'skipped' | 'error'> {
        try {
            const playerData = apiResponse.data;
            if (!playerData?.id || !playerData?.name || !playerData?.mlb_id) {
                console.warn('WalkupSongSyncService: Invalid player data received from API, skipping save.', playerData);
                return 'skipped';
            }

            // --- Parse songs from API Data - START ---
            const newSongsFromApi: WalkupSongSubdocument[] = [];
            if (playerData.songs && Array.isArray(playerData.songs) && playerData.songs.length > 0) {
                for (const apiSong of playerData.songs) {
                    // Safely parse artists with better type checking
                    const parsedArtists: Array<{ name: string; role: 'primary' | 'featured' }> = [];
                    if (apiSong.artists && Array.isArray(apiSong.artists) && apiSong.artists.length > 0) {
                        // Use .name property from the API artist object
                        parsedArtists.push({ name: apiSong.artists[0].name, role: 'primary' as const });
                        for (let i = 1; i < apiSong.artists.length; i++) {
                            // Use .name property from the API artist object
                            parsedArtists.push({ name: apiSong.artists[i].name, role: 'featured' as const });
                        }
                    } else {
                        parsedArtists.push({ name: 'Unknown Artist', role: 'primary' as const });
                    }

                    const normalizedSong: WalkupSongSubdocument = {
                        id: String(apiSong.id || `unknown-${Date.now()}`),
                        songName: String(apiSong.title || 'Unknown Song'),
                        artists: parsedArtists,
                        albumName: String(apiSong.album || ''),
                        spotifyId: String(apiSong.spotify_id || ''),
                        youtubeId: String(apiSong.youtube_id || ''),
                        genre: [], // Initialize empty array, will be populated by genre service
                        albumArt: String(apiSong.spotify_image || ''),
                        previewUrl: apiSong.preview_url || null
                    };
                    newSongsFromApi.push(normalizedSong);
                }
            }
            // --- Parse songs from API Data - END ---

            const existingPlayer = await Player.findOne({ id: String(playerData.id) });

            if (existingPlayer) {
                // --- UPDATE EXISTING PLAYER ---
                const updateData: Partial<PlayerDocument> = {
                    mlbId: String(playerData.mlb_id),
                    name: String(playerData.name),
                    team: String(playerData.team?.name || existingPlayer.team),
                    teamId: String(playerData.team?.id || existingPlayer.teamId),
                    lastUpdated: new Date()
                };

                // Prepare existing songs, preserving genres and artists
                const existingSongsMap = new Map(existingPlayer.walkupSongs.map(s => [s.id, s]));
                const finalSongList: WalkupSongSubdocument[] = [];

                // Add updated/existing songs first
                for (const existingSongDoc of existingPlayer.walkupSongs) {
                    const songObject: WalkupSongSubdocument = {
                        id: String(existingSongDoc.id),
                        songName: String(existingSongDoc.songName),
                        artists: existingSongDoc.artists?.map(a => ({ 
                            name: String(a.name), 
                            role: a.role 
                        })) || [],
                        albumName: String(existingSongDoc.albumName),
                        spotifyId: String(existingSongDoc.spotifyId),
                        youtubeId: String(existingSongDoc.youtubeId),
                        genre: Array.isArray(existingSongDoc.genre) ? existingSongDoc.genre : [],
                        albumArt: String(existingSongDoc.albumArt),
                        previewUrl: existingSongDoc.previewUrl
                    };

                    const matchingNewApiSong = newSongsFromApi.find(newSong => newSong.id === songObject.id);
                    if (matchingNewApiSong) {
                        if (matchingNewApiSong.spotifyId && !songObject.spotifyId) {
                            songObject.spotifyId = String(matchingNewApiSong.spotifyId);
                        }
                        if (matchingNewApiSong.albumArt) {
                            songObject.albumArt = String(matchingNewApiSong.albumArt);
                        }
                    }
                    finalSongList.push(songObject);
                }

                // Add new songs from API
                for (const newApiSong of newSongsFromApi) {
                    if (!existingSongsMap.has(newApiSong.id)) {
                        finalSongList.push(newApiSong);
                    }
                }

                updateData.walkupSongs = finalSongList;

                await Player.updateOne({ id: String(playerData.id) }, { $set: updateData });
                return 'updated';

            } else {
                // --- CREATE NEW PLAYER ---
                const newPlayer = new Player({
                    id: String(playerData.id),
                    mlbId: String(playerData.mlb_id),
                    name: String(playerData.name),
                    position: String(playerData.position || ''),
                    team: String(playerData.team?.name || 'Unknown'),
                    teamId: String(playerData.team?.id || 'Unknown'),
                    lastUpdated: new Date(),
                    walkupSongs: newSongsFromApi,
                    stats: { batting: {}, pitching: {} }
                });
                await newPlayer.save();
                return 'created';
            }
        } catch (error) {
            console.error(`WalkupSongSyncService: Error saving player ${apiResponse?.data?.name || 'ID ' + apiResponse?.data?.id}:`, error);
            return 'error';
        }
    }

    /**
      * Fetches all player data directly from the database.
      * Used by the API endpoint to get data for matching.
     */
    public async getAllPlayersFromDb(): Promise<PlayerWalkupSong[]> {
        try {
            await this.initializeMongoDB(); // Ensure connection
            const players = await Player.find({});
            return players.map(this.mapDocumentToPlayerWalkupSong); // Use helper to map
        } catch (error) {
            console.error('WalkupSongSyncService: Error fetching all players from MongoDB:', error);
            return [];
        }
    }

    // Helper to map DB document to the PlayerWalkupSong type used elsewhere
    private mapDocumentToPlayerWalkupSong(doc: PlayerDocument): PlayerWalkupSong {
        return {
            playerId: doc.id,
            playerName: doc.name,
            position: doc.position,
            team: doc.team,
            teamId: doc.teamId,
            // Map the walkupSongs array
            walkupSongs: (doc.walkupSongs || []).map(song => ({
                id: song.id,
                songName: song.songName,
                // artistName: song.artistName, // REMOVED
                artists: song.artists?.map(a => ({ name: a.name, role: a.role })) || [], // Ensure mapping
                albumName: song.albumName,
                spotifyId: song.spotifyId,
                youtubeId: song.youtubeId,
                genre: song.genre,
                albumArt: song.albumArt,
                previewUrl: song.previewUrl
            })),
            // Map stats
            stats: {
            batting: {
                    battingAvg: doc.stats?.batting?.battingAvg ?? 0,
                    onBasePercentage: doc.stats?.batting?.onBasePercentage ?? 0,
                    sluggingPercentage: doc.stats?.batting?.sluggingPercentage ?? 0,
                    plateAppearances: doc.stats?.batting?.plateAppearances ?? 0
            },
            pitching: {
                    earnedRunAvg: doc.stats?.pitching?.earnedRunAvg ?? 0,
                    inningsPitched: doc.stats?.pitching?.inningsPitched ?? 0
                }
            },
             // Add legacy walkupSong field if needed by other parts (ideally refactor away)
            walkupSong: (doc.walkupSongs && doc.walkupSongs.length > 0)
             ? ({
                  id: doc.walkupSongs[0].id,
                  songName: doc.walkupSongs[0].songName,
                  // artistName: doc.walkupSongs[0].artistName, // REMOVED
                  artists: doc.walkupSongs[0].artists?.map(a => ({ name: a.name, role: a.role })) || [],
                  albumName: doc.walkupSongs[0].albumName,
                  spotifyId: doc.walkupSongs[0].spotifyId,
                  youtubeId: doc.walkupSongs[0].youtubeId,
                  genre: doc.walkupSongs[0].genre,
                  albumArt: doc.walkupSongs[0].albumArt,
                  previewUrl: doc.walkupSongs[0].previewUrl
                })
             : { id: 'unknown', songName: 'Unknown', artists: [], albumName: '', spotifyId: '', youtubeId: '', genre: [], albumArt: '', previewUrl: null }, // Provide default structure
            // Pass match details if they exist (though they likely belong in PlayerWithScore)
            matchReason: doc.matchReason,
            rankInfo: doc.rankInfo,
            matchScore: doc.matchScore,
            // matchingSongs: [] // This should be populated by matcher service, not read directly from DB player doc
        };
    }
}