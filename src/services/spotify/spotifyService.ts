// src/services/spotify/spotifyService.ts
import SpotifyWebApi from 'spotify-web-api-node';
import { Session } from 'next-auth';
import axios from 'axios'; // Ensure Axios is imported

// --- Interfaces ---
// (Keep existing interfaces: SpotifyUserProfile, SpotifyImage, SpotifyTopItem, SpotifyGenreSummary)
export interface SpotifyUserProfile {
    id: string;
    display_name: string | null;
    images?: Array<{ url: string; height?: number; width?: number }>; // Make images optional
    followers?: { total: number }; // Make followers optional
    email?: string; // Added email potentially available
}

export interface SpotifyImage {
    url: string;
    height?: number;
    width?: number;
}

export interface SpotifyAlbum {
    id: string;
    name: string;
    images: SpotifyImage[];
    artists?: Array<{ id: string; name: string }>; // Added artists to album potentially
    release_date?: string;
}

export interface SpotifyArtist {
    id: string;
    name: string;
    genres?: string[];
    images?: SpotifyImage[];
}

export interface SpotifyTrack {
    id: string;
    name: string;
    artists: Array<{ id: string; name: string }>;
    album: SpotifyAlbum;
    preview_url: string | null;
    duration_ms?: number;
    popularity?: number;
    external_urls?: { spotify?: string };
}

// Combined type for top items, tracks, artists
export interface SpotifyTopItem {
    id: string;
    name: string;
    type: 'track' | 'artist';
    images?: SpotifyImage[]; // For artists
    album?: SpotifyAlbum; // For tracks
    artists?: Array<{ id: string; name: string }>; // For tracks
    preview_url?: string | null; // For tracks
    genres?: string[]; // For artists
}

export interface SpotifyGenreSummary {
    name: string;
    count: number;
    weight: number;
}
// --- End Interfaces ---

/**
 * Service class for interacting with Spotify API
 */
export class SpotifyService {
    private spotifyApi: SpotifyWebApi;
    private accessToken: string; // Store access token for direct Axios calls

    constructor(accessToken: string) {
        if (!accessToken) {
            throw new Error("SpotifyService: Access token cannot be empty or null.");
        }
        this.accessToken = accessToken; // Store the token
        this.spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        });
        this.spotifyApi.setAccessToken(accessToken);
        // console.log("SpotifyService initialized with new token."); // Debug log
    }

    /**
     * Create a SpotifyService instance from a NextAuth session
     */
    static fromSession(session: Session | null): SpotifyService | null {
        if (!session?.accessToken) {
            console.error("SpotifyService: Cannot create from session without valid accessToken.");
            return null;
        };
        return new SpotifyService(session.accessToken as string);
    }

    /**
     * Get the current user's Spotify profile
     */
    async getUserProfile(): Promise<SpotifyUserProfile> {
        try {
            const response = await this.spotifyApi.getMe();
            // Provide default values if parts of the response are missing
            return {
                id: response.body.id,
                display_name: response.body.display_name || null,
                images: response.body.images || [],
                followers: response.body.followers || { total: 0 },
                email: response.body.email
            };
        } catch (error) {
            console.error("SpotifyService: Error fetching user profile:", error);
            throw error; // Re-throw after logging
        }
    }

    /**
     * Get the user's top tracks
     */
    async getTopTracks(limit = 50, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'): Promise<SpotifyTopItem[]> {
        try {
            const response = await this.spotifyApi.getMyTopTracks({
                limit: Math.min(limit, 50), // Ensure limit doesn't exceed 50
                time_range: timeRange
            });
            // Add null checks for safety
            return (response.body.items || []).map((track): SpotifyTopItem => ({
                id: track.id,
                name: track.name || 'Unknown Track',
                type: 'track',
                album: track.album as SpotifyAlbum, // Assume structure matches
                artists: track.artists || [],
                preview_url: track.preview_url || null
            }));
        } catch (error) {
             console.error(`SpotifyService: Error fetching top tracks (${timeRange}):`, error);
             return []; // Return empty array on error
        }
    }

    /**
     * Get the user's top artists
     */
    async getTopArtists(limit = 50, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'): Promise<SpotifyTopItem[]> {
         try {
            const response = await this.spotifyApi.getMyTopArtists({
                limit: Math.min(limit, 50), // Ensure limit doesn't exceed 50
                time_range: timeRange
            });
            // Add null checks for safety
            return (response.body.items || []).map((artist): SpotifyTopItem => ({
                id: artist.id,
                name: artist.name || 'Unknown Artist',
                type: 'artist',
                images: artist.images || [],
                genres: artist.genres || []
            }));
         } catch (error) {
              console.error(`SpotifyService: Error fetching top artists (${timeRange}):`, error);
              return []; // Return empty array on error
         }
    }

    /**
     * Extract genres from user's top artists and calculate weight
     */
    async getUserGenres(): Promise<SpotifyGenreSummary[]> {
        try {
            // Fetch artists using a reliable timeframe, e.g., medium_term
            const topArtists = await this.getTopArtists(50, 'medium_term');
            if (!topArtists || topArtists.length === 0) {
                return [];
            }
            const genreMap = new Map<string, number>();
            let totalArtistsWithGenres = 0;

            topArtists.forEach(artist => {
                // Ensure genres is an array before iterating
                const genres = artist.genres || [];
                if (genres.length > 0) {
                    totalArtistsWithGenres++;
                    genres.forEach(genre => {
                        genreMap.set(genre, (genreMap.get(genre) || 0) + 1);
                    });
                }
            });

            if (totalArtistsWithGenres === 0) return []; // Avoid division by zero

            const genres = Array.from(genreMap.entries()).map(([name, count]) => ({
                name,
                count,
                // Calculate weight relative to artists that *have* genre data
                weight: count / totalArtistsWithGenres
            }));

            return genres.sort((a, b) => b.count - a.count); // Sort by count desc
        } catch (error) {
            console.error("SpotifyService: Error calculating user genres:", error);
            return [];
        }
    }

    /**
     * Create a playlist in the user's account
     */
    async createPlaylist(name: string, description: string): Promise<{ id: string; url: string } | null> {
        try {
            const user = await this.getUserProfile();
            if (!user || !user.id) {
                console.error("SpotifyService: Cannot create playlist without user ID.");
                return null;
            }

            const response = await this.spotifyApi.createPlaylist(user.id, {
                name,
                description,
                public: false // Assuming private playlist creation
            } as any); // Use 'as any' or define specific type if library typing is off

            return {
                id: response.body.id,
                url: response.body.external_urls?.spotify || '' // Handle potential missing URL
            };
        } catch (error) {
             console.error("SpotifyService: Error creating playlist:", error);
             return null;
        }
    }

    /**
     * Add tracks to a playlist
     */
    async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<boolean> {
        if (!playlistId || !trackUris || trackUris.length === 0) {
            console.warn("SpotifyService: Skipping addTracksToPlaylist due to invalid input.");
            return false;
        }
        try {
            // Add tracks in batches of 100 (Spotify limit)
             const batchSize = 100;
             for (let i = 0; i < trackUris.length; i += batchSize) {
                 const batch = trackUris.slice(i, i + batchSize);
                 console.log(`SpotifyService: Adding batch of ${batch.length} tracks to playlist ${playlistId}`);
                 await this.spotifyApi.addTracksToPlaylist(playlistId, batch);
                 // Optional: add a small delay between batches if needed
                 if (i + batchSize < trackUris.length) {
                     await new Promise(resolve => setTimeout(resolve, 200));
                 }
             }
             return true; // Indicate success
        } catch (error) {
            console.error(`SpotifyService: Error adding tracks to playlist ${playlistId}:`, error);
            return false; // Indicate failure
        }
    }

    /**
     * Get the user's saved tracks
     */
    async getSavedTracks(limit = 50): Promise<SpotifyTopItem[]> {
         try {
            const response = await this.spotifyApi.getMySavedTracks({ limit: Math.min(limit, 50) }); // Respect API limit
            return (response.body.items || []).map((item): SpotifyTopItem | null => {
                 const track = item.track;
                 if (!track) return null; // Skip if track data is missing
                return {
                    id: track.id,
                    name: track.name || 'Unknown Track',
                    type: 'track',
                    album: track.album as SpotifyAlbum,
                    artists: track.artists || [],
                    preview_url: track.preview_url || null
                };
            }).filter((item): item is SpotifyTopItem => item !== null); // Filter out any null items
        } catch (error) {
            console.error("SpotifyService: Error getting saved tracks:", error);
            return [];
        }
    }

    /**
     * Get track details from Spotify
     */
    async getTrackDetails(trackId: string): Promise<SpotifyTopItem | null> {
        if (!trackId) return null;
        try {
            const response = await this.spotifyApi.getTrack(trackId);
             const track = response.body;
             if (!track) return null;
            return {
                id: track.id,
                name: track.name || 'Unknown Track',
                type: 'track',
                album: track.album as SpotifyAlbum,
                artists: track.artists || [],
                preview_url: track.preview_url || null
            };
        } catch (error) {
            // Handle 404 Not Found specifically if needed, otherwise log generic error
            if (error.statusCode === 404) {
                 console.warn(`SpotifyService: Track ID ${trackId} not found.`);
            } else {
                 console.error(`SpotifyService: Error fetching track details for ${trackId}:`, error);
            }
            return null;
        }
    }

    /**
     * Search for a track on Spotify
     */
    async searchTrack(songName: string, artistName: string): Promise<SpotifyTopItem | null> {
         if (!songName || !artistName) return null;
        try {
            // Clean up query slightly - use only primary artist for better matching potential
             const primaryArtist = artistName.split(/[,&;]/)[0].trim(); // Get first artist before separators
             const query = `track:${songName.trim()} artist:${primaryArtist}`;
            const response = await this.spotifyApi.searchTracks(query, { limit: 1 });

            if (response.body.tracks && response.body.tracks.items && response.body.tracks.items.length > 0) {
                const track = response.body.tracks.items[0];
                return {
                    id: track.id,
                    name: track.name || 'Unknown Track',
                    type: 'track',
                    album: track.album as SpotifyAlbum,
                    artists: track.artists || [],
                    preview_url: track.preview_url || null
                };
            }
            // console.log(`SpotifyService: No search result for track "${songName}" by ${artistName} (Query: ${query})`);
            return null;
        } catch (error) {
            console.error(`SpotifyService: Error searching track "${songName}" by ${artistName}:`, error);
            return null;
        }
    }

    /**
     * Checks if multiple tracks are present in the user's "Liked Songs".
     * Pre-validates ID format before sending to Spotify API.
     * @param spotifyIds Array of Spotify Track IDs to check.
     * @returns A Promise resolving to an array of booleans, corresponding to the input IDs.
     */
    async checkSongsInLikedTracks(spotifyIds: string[]): Promise<boolean[]> {
        // Ensure prerequisites are met
        if (!this.accessToken) {
            console.error('SpotifyService: Access token is missing. Cannot check liked tracks.');
            // Return array of false matching the input length
            return Array(spotifyIds?.length || 0).fill(false);
        }
        if (!spotifyIds || spotifyIds.length === 0) {
            return []; // Return empty array if no IDs provided
        }

        // 1. Initialize results map & Pre-validate IDs
        const spotifyIdRegex = /^[a-zA-Z0-9]{22}$/; // Regex for 22 alphanumeric characters
        const resultsMap = new Map<string, boolean>();
        const potentiallyValidIds: string[] = [];

        // Initialize all original IDs to false in the map and filter valid ones
        spotifyIds.forEach(id => {
            const originalId = id; // Keep track of the original value
            if (id && typeof id === 'string' && spotifyIdRegex.test(id)) {
                potentiallyValidIds.push(id);
                resultsMap.set(originalId, false); // Initialize potentially valid as unchecked (false)
            } else {
                // Invalid format, null, or empty ID - ensure it's mapped as false
                 if (originalId !== null && originalId !== undefined) { // Avoid mapping null/undefined keys
                    resultsMap.set(String(originalId), false);
                 }
            }
        });

        const filteredOutCount = spotifyIds.length - potentiallyValidIds.length;
        if (filteredOutCount > 0) {
            console.log(`SpotifyService: Pre-filtered ${filteredOutCount} invalid/malformed Spotify IDs.`);
        }

        // If no IDs are potentially valid, return early
        if (potentiallyValidIds.length === 0) {
            console.warn("SpotifyService: No potentially valid Spotify IDs to check after filtering.");
            return spotifyIds.map(id => resultsMap.get(id) ?? false); // Map original IDs using the (all false) map
        }

        // 2. Batch Processing (Only for potentially valid IDs)
        const batchSize = 50;
        console.log(`SpotifyService: Checking liked status for ${potentiallyValidIds.length} potentially valid tracks...`);

        try {
            for (let i = 0; i < potentiallyValidIds.length; i += batchSize) {
                const batch = potentiallyValidIds.slice(i, i + batchSize);
                const idsParam = batch.join(',');
                // IMPORTANT: Ensure this URL is exactly what Spotify expects. Double-check API docs if needed.
                // The previous URL 'https://api.spotify.com/v1/me/tracks/contains?ids=$$3EQ9QP2E7wjYQba8OSPBst,5ItzU5pBrFmRUudfr5RkJP,4Zv2NRAUtDNh8sjlqqhO3j,0biVzpdI2z0vAxwfU9xuuA,4NTSDu34al733aIuUWVJHo,5VdxS3tU3hPoG7bunIte9F,2r6OAV3WsYtXuXjvJ1lIDi,6Bwf5HGnWCjRevYA7UipHK,6HgWWaMu31KdOpEG5l28BG,19LT4ZUEeoUdimKE04WJJg,5jFA0f4ZDGLbQP4nxzL8D4,6GomT970rCOkKAyyrwJeZi,7BKi4ZcyMBXeAvJ1OPxhdV,6mz1fBdKATx6qP4oP1I65G,2eOuL8KesslTLQERQPu11D,5bUlFE9dGh7pX93PUEVAue,5iDcBu1OOvRj3d494IIkUH,23SZWX2IaDnxmhFsSLvkG2,2rUwQj4SWaP2anuGDtNpYR,6AIZHjujMcYXIZB83K9PvP,5ig5qGllxwN8SgKWY9PKz2,4Xtlw8oXkIOvzV7crUBKeZ,6hgoYQDUcPyCz7LcTUHKxa,19a3JfW8BQwqHWUMbcqSx8,5Tbpp3OLLClPJF8t1DmrFD,7oLMUdDtbKPWCDuQvkrIlA,6xhm6kwy3VUGJ6SsbtjDsE,0jufehOY40rRdvB2t4dsot,0GRT9P0kiULOW4VDDVROfk,7dbOcZwBpDCUqR7sIz3djU,0zFJLHiNh56GuhNczgVqpm,0R6NfOiLzLj4O5VbYSJAjf,0uxSUdBrJy9Un0EYoBowng,1LDwUN1jMnTK7vCZBFoTYe,7K3BhSpAxZBznislvUMVtn,59XHPyb0MTMElZpkG0Wp69,7dltD9eEX7X1zk8JJ9BS0e,3qLgWZabS3bEZyKTjPbq5V,5f4Hy5mw5SRaUgXX9c6P5S,7fveJ3pk1eSfxBdVkzdXZ0,1EBSSovKw4KZWsQPxKxYAD,0oPOuDmmkVp3h6puekhs6P,5ih5herXfvp5coBVFhmoAW,0MwYJDOn9aSNDsJKRlSU8B,4qdJeQlPfs2sKSHWUVchpi,61HhjqBaSKwgcgd1YuIvgs,5gcD6WgSnQqzRzgspwLOi8,1OgZJJNUjN3FFbdTrkG2WH,4aU0JZdoZ9iKnP4A0lYvyQ,1hc31O4qhv2tnSnW1290KC...' seemed incorrect. Using standard Spotify API URL:
                const apiUrl = `https://api.spotify.com/v1/me/tracks/contains?ids=${idsParam}`;

                try {
                    const response = await axios.get<boolean[]>(apiUrl, {
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000 // 10 second timeout
                    });

                    if (response.data && Array.isArray(response.data) && response.data.length === batch.length) {
                        // Update results map ONLY for the IDs in this successful batch
                        batch.forEach((id, index) => {
                            resultsMap.set(id, response.data[index]); // Update map with true/false result
                        });
                    } else {
                        console.error('SpotifyService: Unexpected response format from Spotify /me/tracks/contains:', { status: response.status, data: response.data, expectedLength: batch.length });
                        // Mark IDs in this specific batch as false in the results map
                        batch.forEach(id => resultsMap.set(id, false));
                    }

                } catch (batchError) {
                    console.error(`SpotifyService: Error checking API batch starting with ${batch[0]}:`, batchError instanceof Error ? batchError.message : batchError);
                    if (axios.isAxiosError(batchError)) {
                        console.error('Spotify API Error Details:', {
                            status: batchError.response?.status,
                            config: { method: batchError.config?.method, url: batchError.config?.url },
                            response: batchError.response?.data // Log the actual error response from Spotify
                        });
                         // Mark IDs in this specific failing batch as false
                         batch.forEach(id => resultsMap.set(id, false));
                    } else {
                        // Non-axios error, mark batch as false too
                        batch.forEach(id => resultsMap.set(id, false));
                    }
                    // Continue to the next batch even if one fails
                }

                // Optional delay between batches
                if (i + batchSize < potentiallyValidIds.length) {
                    await new Promise(r => setTimeout(r, 100));
                }
            } // End for loop
        } catch (error) {
             // Catch errors outside the batch loop
             console.error('SpotifyService: Unexpected error during liked tracks check loop:', error);
             // Mark any remaining potentially valid IDs as false if not already set
             potentiallyValidIds.forEach(id => {
                 if (!resultsMap.has(id) || resultsMap.get(id) === undefined) resultsMap.set(id, false);
             })
        }

        // 3. Map results back to the original spotifyIds array structure/order
        const finalResults = spotifyIds.map(id => resultsMap.get(id) ?? false); // Default to false if ID wasn't valid or encountered error
        const finalLikedCount = finalResults.filter(Boolean).length;
        console.log(`SpotifyService: Finished liked tracks check. Final liked count: ${finalLikedCount}/${potentiallyValidIds.length} potentially valid tracks.`);
        return finalResults;
    }


    /**
     * Get a default album art URL (e.g., a placeholder)
     */
    getDefaultAlbumArt(): string {
        // Using a simple placeholder API URL
        return `https://via.placeholder.com/64/cccccc/969696?text=N/A`;
        // Or return '/api/placeholder/album/64'; // If you keep your placeholder API
    }

    /**
     * Get the best available album art URL from an array of images.
     * Prefers 300px, then 64px, then largest available, then first, then default.
     */
    getBestAlbumArtUrl(images: SpotifyImage[] | undefined): string {
        if (!images || images.length === 0) {
            return this.getDefaultAlbumArt();
        }

        // Try to find specific sizes
        const size300 = images.find(img => img.height === 300 && img.width === 300);
        if (size300) return size300.url;

        const size64 = images.find(img => img.height === 64 && img.width === 64);
        if (size64) return size64.url;

        // Find largest available (by height, assuming square or portrait bias)
        const largest = images.reduce((largestImg, currentImg) =>
            (currentImg.height ?? 0) > (largestImg.height ?? 0) ? currentImg : largestImg
        , images[0]); // Start with the first image as initial largest
        if (largest?.url) return largest.url;

        // Fallback to the very first image URL if reduction failed (shouldn't happen)
        if (images[0]?.url) return images[0].url;

        // Final fallback
        return this.getDefaultAlbumArt();
    }


    /**
     * Get user's top tracks across all time frames concurrently.
     */
    async getAllTopTracks(): Promise<{ short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] }> {
        try {
            const [short_term, medium_term, long_term] = await Promise.all([
                this.getTopTracks(50, 'short_term'),
                this.getTopTracks(50, 'medium_term'),
                this.getTopTracks(50, 'long_term')
            ]);
            return { short_term, medium_term, long_term };
        } catch (error) {
             console.error("SpotifyService: Error fetching all top tracks:", error);
             return { short_term: [], medium_term: [], long_term: [] }; // Return empty on error
        }
    }

    /**
     * Get user's top artists across all time frames concurrently.
     */
    async getAllTopArtists(): Promise<{ short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] }> {
        try {
            const [short_term, medium_term, long_term] = await Promise.all([
                this.getTopArtists(50, 'short_term'),
                this.getTopArtists(50, 'medium_term'),
                this.getTopArtists(50, 'long_term')
            ]);
            return { short_term, medium_term, long_term };
        } catch (error) {
             console.error("SpotifyService: Error fetching all top artists:", error);
             return { short_term: [], medium_term: [], long_term: [] }; // Return empty on error
        }
    }
}